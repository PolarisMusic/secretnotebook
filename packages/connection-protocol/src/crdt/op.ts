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

/** Cap on a single note's body. 4 KiB is plenty for a journal entry
 *  and small enough to keep one envelope well under the relay's
 *  payload limit. Bumped later if a richer format demands it. */
const NOTE_BODY_MAX = 4096;

/**
 * Shared-note creation. Body travels with the op — both sides see
 * substance as soon as the op is applied. Recipient INSERTs OR IGNOREs
 * keyed on id; replays + late deliveries collapse into one row.
 */
export const NoteShareAddOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('note.share.add'),
  id: z.string().uuid(),
  authorPubkey: HexString(32),
  body: z.string().min(1).max(NOTE_BODY_MAX),
  createdAt: z.number().int().nonnegative(),
});
export type NoteShareAddOp = z.infer<typeof NoteShareAddOpSchema>;

/**
 * Secret-note announcement. Conveys that the note EXISTS — id, author,
 * timestamp — and nothing about its substance. The body never appears
 * in this op. Recipient INSERTs a `note` row with body=NULL.
 *
 * Pair this with NoteSecretRevealOp, which the author sends only when
 * they choose to publish the body. The split is the privacy primitive
 * the connection-channel R2 promises: "the relay sees announce, never
 * the body itself".
 */
export const NoteSecretAnnounceOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('note.secret.announce'),
    id: z.string().uuid(),
    authorPubkey: HexString(32),
    createdAt: z.number().int().nonnegative(),
  })
  // Strict: refuse unknown keys. This locks in the privacy
  // invariant — a future contributor cannot widen the announce op
  // with a `body` (or any other field) and have it ride the
  // ratchet undetected; the schema parse will reject the op at the
  // serialise() boundary.
  .strict();
export type NoteSecretAnnounceOp = z.infer<typeof NoteSecretAnnounceOpSchema>;

/**
 * Secret-note reveal. Carries the body for an already-announced secret
 * note. Recipient UPDATEs the existing row's body + revealed_at; if
 * the row hasn't shown up yet (extremely rare — would require strict-
 * order-violating delivery between sender and receiver on the same
 * ratchet), the UPDATE is a no-op and the row stays bodyless until a
 * future replay catches it. Causal ordering on the ratchet means the
 * announce that preceded the reveal in the outbox is decrypted first
 * in the normal case, so this race is theoretical.
 */
export const NoteSecretRevealOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('note.secret.reveal'),
  id: z.string().uuid(),
  body: z.string().min(1).max(NOTE_BODY_MAX),
  revealedAt: z.number().int().nonnegative(),
});
export type NoteSecretRevealOp = z.infer<typeof NoteSecretRevealOpSchema>;

export const CrdtOpSchema = z.discriminatedUnion('kind', [
  SavedPostAddOpSchema,
  LedgerEntryAddOpSchema,
  NoteShareAddOpSchema,
  NoteSecretAnnounceOpSchema,
  NoteSecretRevealOpSchema,
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
