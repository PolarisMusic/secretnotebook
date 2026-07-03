import { z } from 'zod';

const EnvSchema = z.object({
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
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
