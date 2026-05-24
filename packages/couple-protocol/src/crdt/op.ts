import { z } from 'zod';

const HexString = (bytes: number): z.ZodString =>
  z
    .string()
    .regex(/^[0-9a-f]+$/i, 'must be lowercase hex')
    .length(bytes * 2, `must encode exactly ${bytes} bytes`);

/**
 * Add-only set op for a `saved_post` row. The recipient applies it with
 * INSERT OR IGNORE keyed on id, so duplicate deliveries (replays, late
 * deliveries) collapse into a single row.
 */
export const SavedPostAddOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('saved_post.add'),
  id: z.string().uuid(),
  globalPostId: z.string().uuid(),
  savedByPubkey: HexString(32),
  savedForPubkey: HexString(32),
  createdAt: z.number().int().nonnegative(),
});
export type SavedPostAddOp = z.infer<typeof SavedPostAddOpSchema>;

/**
 * Add-only set op for a `ledger_entry` row. Same idempotency story as
 * saved_post: the row's id is the dedup key.
 */
export const LedgerEntryAddOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('ledger_entry.add'),
  id: z.string().uuid(),
  ledgerKind: z.literal('couple_points'),
  delta: z.number().int(),
  reason: z.string().min(1).max(120),
  refId: z.string().uuid().nullable(),
  createdAt: z.number().int().nonnegative(),
});
export type LedgerEntryAddOp = z.infer<typeof LedgerEntryAddOpSchema>;

export const CrdtOpSchema = z.discriminatedUnion('kind', [
  SavedPostAddOpSchema,
  LedgerEntryAddOpSchema,
]);
export type CrdtOp = z.infer<typeof CrdtOpSchema>;

/**
 * Serialise an op for the ratchet payload. JSON for Phase 1 — easy to
 * reason about and to property-test. A binary frame can be swapped in
 * later behind this boundary without touching the sync engine.
 */
export function serialiseOp(op: CrdtOp): Uint8Array {
  // Validate at the boundary so a malformed op can't poison the wire.
  const parsed = CrdtOpSchema.parse(op);
  return new TextEncoder().encode(JSON.stringify(parsed));
}

export function deserialiseOp(bytes: Uint8Array): CrdtOp {
  const text = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(text) as unknown;
  return CrdtOpSchema.parse(parsed);
}
