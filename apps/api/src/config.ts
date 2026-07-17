import { z } from 'zod';

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().url().optional(),
    SIGNATURE_MAX_DRIFT_SECONDS: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RELAY_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // Encrypted media blobs are an ephemeral transfer channel: once both
    // peers have pulled an attachment it lives on-device, so the server copy
    // only needs to survive long enough to bridge an offline partner. A short
    // default keeps Fly/Postgres storage (and the bill) small. Override via
    // the BLOB_TTL_DAYS secret without a redeploy.
    BLOB_TTL_DAYS: z.coerce.number().int().positive().default(3),
    // Max ciphertext bytes per blob upload. 32 MiB covers a 25 MiB plaintext
    // attachment plus chunked-AEAD framing overhead.
    BLOB_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(32 * 1024 * 1024),
    /** Bearer token for the prompt admin surface (/v1/admin/prompts and
     *  /v1/admin/ui). When unset, the admin surface is NOT registered —
     *  the operator must set this to opt in, so no admin endpoints exist
     *  on a fresh deploy by accident. Minimum 16 chars for any chance at
     *  brute-force resistance. */
    ADMIN_TOKEN: z.string().min(16).optional(),

    /** Where encrypted media blobs are stored.
     *   - 'postgres' (default): inline BYTEA in the blobs table — simplest,
     *     but large media inflates the Postgres/Fly bill.
     *   - 's3': ciphertext in an S3-compatible bucket (AWS S3 or Cloudflare
     *     R2), with only metadata in Postgres. Requires the S3_* vars below. */
    BLOB_BACKEND: z.enum(['postgres', 's3']).default('postgres'),
    /** Custom S3 endpoint — set for Cloudflare R2
     *  (https://<account>.r2.cloudflarestorage.com) or MinIO; omit for AWS S3. */
    S3_ENDPOINT: z.string().url().optional(),
    /** Bucket region. R2 uses 'auto'; AWS uses e.g. 'us-east-1'. */
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Force path-style addressing (needed by some S3-compatibles). */
    S3_FORCE_PATH_STYLE: z
      .enum(['0', '1', 'true', 'false'])
      .transform((v) => v === '1' || v === 'true')
      .default('false'),
  })
  .superRefine((env, ctx) => {
    // The S3 backend can't start without a bucket + credentials — fail fast at
    // boot rather than 500 on the first upload.
    if (env.BLOB_BACKEND === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when BLOB_BACKEND=s3`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
