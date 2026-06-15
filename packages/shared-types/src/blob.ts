import { z } from 'zod';

/**
 * Opaque encrypted-blob store. The server holds only ciphertext (chunked-AEAD
 * output, see @secretnotebook/crypto) addressed by a random handle it assigns;
 * it never sees the content key, which rides the E2E note op. This mirrors the
 * relay's "store ciphertext, learn nothing" posture for large media that can't
 * fit the ratchet/CRDT path.
 */
export const BlobUploadResponseSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
});
export type BlobUploadResponse = z.infer<typeof BlobUploadResponseSchema>;

export const BlobIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type BlobIdParams = z.infer<typeof BlobIdParamsSchema>;

export const BlobDeleteResponseSchema = z.object({ ok: z.literal(true) });
export type BlobDeleteResponse = z.infer<typeof BlobDeleteResponseSchema>;
