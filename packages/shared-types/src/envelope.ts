import { z } from 'zod';

const Base64String = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'must be base64')
  .min(1);

export const SyncEnvelopeSchema = z.object({
  v: z.literal(1),
  recipientBlindedId: z
    .string()
    .regex(/^[0-9a-f]+$/i, 'must be lowercase hex')
    .length(64, 'must encode exactly 32 bytes'),
  header: Base64String,
  ciphertext: Base64String,
  sentAt: z.string().datetime({ offset: true }),
});
export type SyncEnvelope = z.infer<typeof SyncEnvelopeSchema>;

export const SyncEnvelopeListSchema = z.object({
  items: z.array(SyncEnvelopeSchema.extend({ id: z.string().uuid() })),
  nextCursor: z.string().nullable(),
});
export type SyncEnvelopeList = z.infer<typeof SyncEnvelopeListSchema>;
