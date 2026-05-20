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

export const ReceivedSyncEnvelopeSchema = SyncEnvelopeSchema.extend({
  id: z.string().uuid(),
  receivedAt: z.string().datetime({ offset: true }),
});
export type ReceivedSyncEnvelope = z.infer<typeof ReceivedSyncEnvelopeSchema>;

export const SyncEnvelopeListSchema = z.object({
  items: z.array(ReceivedSyncEnvelopeSchema),
  nextCursor: z.string().nullable(),
});
export type SyncEnvelopeList = z.infer<typeof SyncEnvelopeListSchema>;

export const RelayPostResponseSchema = z.object({
  id: z.string().uuid(),
  receivedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});
export type RelayPostResponse = z.infer<typeof RelayPostResponseSchema>;

export const RelayInboxQuerySchema = z.object({
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type RelayInboxQuery = z.infer<typeof RelayInboxQuerySchema>;

export const RelayInboxParamsSchema = z.object({
  blindedId: z
    .string()
    .regex(/^[0-9a-f]+$/i, 'must be lowercase hex')
    .length(64, 'must encode exactly 32 bytes'),
});
export type RelayInboxParams = z.infer<typeof RelayInboxParamsSchema>;

export const RelayDeleteParamsSchema = z.object({
  blindedId: z
    .string()
    .regex(/^[0-9a-f]+$/i, 'must be lowercase hex')
    .length(64, 'must encode exactly 32 bytes'),
  envelopeId: z.string().uuid(),
});
export type RelayDeleteParams = z.infer<typeof RelayDeleteParamsSchema>;

export const RelayDeleteResponseSchema = z.object({ ok: z.literal(true) });
export type RelayDeleteResponse = z.infer<typeof RelayDeleteResponseSchema>;
