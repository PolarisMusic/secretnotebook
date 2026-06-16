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
 * Add-only set op for a `ledger_entry` row. **Revived in R7** to carry
 * Couple-Points awards for the secret-note unlock loop (one award on
 * verify, one on mutual reflection). The Author's device is the single
 * writer per attempt (`awardCouplePoints`, idempotent on the
 * (reason, refId) pair); the recipient applies it with INSERT OR IGNORE
 * keyed on id, so replays + the author's own echo collapse into one
 * row. `refId` points at the `secret_unlock` attempt the award belongs
 * to.
 *
 * History: retired in R6.2 (projector no-op) after R0 deleted the
 * Phase-1 writer; R7 restores both the writer (ledger/store.ts) and the
 * projector INSERT. A stale pre-R7 envelope still parses cleanly.
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

/** Cap on a single note's body. Pinned to 4000 to match the server's
 *  PostInputSchema.body.max(4000) so any note that fits locally can
 *  always be promoted to the global feed without a length-rejection
 *  surprise at publish time. Bumped together with the server cap if
 *  a richer format demands it. */
const NOTE_BODY_MAX = 4000;

/**
 * Hard caps on couple-note media. A photo is single-digit MB and a short
 * voice note a few hundred KB; 25 MiB leaves generous headroom while keeping
 * the v1 single-PUT blob path (no resumable upload yet) honest. Bumped
 * together with the blob route's bodyLimit if richer media demands it.
 */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** Cap attachments per note so one op can't fan out an unbounded set. */
export const MAX_ATTACHMENTS_PER_NOTE = 8;

/** Media kinds carried by this milestone. Widening requires a coordinated
 *  renderer + picker change on the client, so it is an explicit enum. */
export const AttachmentMediaTypeSchema = z.enum(['image', 'audio']);
export type AttachmentMediaType = z.infer<typeof AttachmentMediaTypeSchema>;

/**
 * Pointer to one encrypted media blob, carried INSIDE the E2E-encrypted note
 * op (never on the relay/blob server in the clear). It hands the partner
 * everything needed to fetch and decrypt the bytes: the opaque server
 * `blobId`, the per-blob `contentKey` + `noncePrefix` for the chunked AEAD
 * (see @secretnotebook/crypto), the plaintext `byteSize` + `contentHash` to
 * verify after reassembly, and light render hints (dimensions / duration).
 *
 * `.strict()`: an attachment must be exactly this shape — a future field
 * cannot ride along unnoticed, mirroring the announce-op privacy lock.
 */
export const AttachmentDescriptorSchema = z
  .object({
    id: z.string().uuid(),
    blobId: z.string().uuid(),
    mediaType: AttachmentMediaTypeSchema,
    mimeType: z.string().min(1).max(128),
    byteSize: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
    contentHash: HexString(32),
    contentKey: HexString(32),
    noncePrefix: HexString(16),
    chunkSize: z.number().int().positive(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AttachmentDescriptor = z.infer<typeof AttachmentDescriptorSchema>;

/**
 * Optional attachment list on a body-bearing note op. Kept `.optional()` (not
 * `.default([])`) so an op authored without media serialises with no
 * `attachments` key at all — pre-media clients' ops still round-trip
 * byte-for-byte and the wire stays minimal.
 */
const NoteAttachmentsSchema = z
  .array(AttachmentDescriptorSchema)
  .max(MAX_ATTACHMENTS_PER_NOTE)
  .optional();

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
  // Optional so a media-only note (a photo with no caption) is expressible.
  // When present it is non-empty; writers enforce "non-empty body OR >=1
  // attachment" — the wire schema can't (a discriminatedUnion member may not
  // be `.refine`d), but an empty note is harmless if one ever slips through.
  body: z.string().min(1).max(NOTE_BODY_MAX).optional(),
  attachments: NoteAttachmentsSchema,
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
  // Optional, like share.add: a revealed secret may be media-only. The
  // substance (body and/or attachments) appears only here, never on announce.
  body: z.string().min(1).max(NOTE_BODY_MAX).optional(),
  attachments: NoteAttachmentsSchema,
  revealedAt: z.number().int().nonnegative(),
});
export type NoteSecretRevealOp = z.infer<typeof NoteSecretRevealOpSchema>;

/**
 * Note has been promoted to a public post on the global feed. Mirrors
 * the publish action across the connection so the partner's local
 * row gets the same `published_at` + `published_global_post_id`
 * stamping; the recipient projector UPDATEs WHERE published_at IS
 * NULL so first publish wins and a hostile or replayed publish op
 * cannot overwrite the existing record.
 *
 * Carries no body — the body is already on the public feed (and was
 * already on both sides' local rows before publish), so the op only
 * needs to tell the partner "this note is now public, here's the
 * post id to follow."
 */
export const NotePublishOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('note.publish'),
  id: z.string().uuid(),
  publishedGlobalPostId: z.string().uuid(),
  publishedAt: z.number().int().nonnegative(),
});
export type NotePublishOp = z.infer<typeof NotePublishOpSchema>;

/** Three-value role taxonomy for now. Widening to additional values
 *  requires a coordinated migration + protocol version bump. */
export const ConnectionRoleSchema = z.enum(['masculine', 'feminine', 'neutral']);
export type ConnectionRole = z.infer<typeof ConnectionRoleSchema>;

/**
 * Each partner self-declares their role on the connection. The
 * `setterPubkey` identifies which side this op is for — the recipient
 * matches it against partner_a_pubkey / partner_b_pubkey to know
 * which column to write. Last-write-wins by ratchet order: a setter
 * can change their mind by emitting a new op; the ratchet preserves
 * causal order on a single sender so the latest value sticks.
 *
 * Replays are practically prevented by the seen-cache (sync_seen) +
 * outbox-delete-on-success; the projector doesn't need a separate
 * setAt comparison.
 */
export const ConnectionRoleSetOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('connection.role.set'),
  setterPubkey: HexString(32),
  role: ConnectionRoleSchema,
  setAt: z.number().int().nonnegative(),
});
export type ConnectionRoleSetOp = z.infer<typeof ConnectionRoleSetOpSchema>;

/**
 * Roleplay-term (Safe Word) handshake — propose half. The proposer derives
 * the Argon2id verifier locally and sends only the hash; the salt is
 * deterministic from the shared connection root, so the partner re-derives
 * it and matches a typed candidate against this verifier ("type it back to
 * match"). The plaintext word never rides the wire. Last-write-wins by
 * ratchet order: a fresh propose supersedes an earlier in-flight one.
 */
export const ConnectionSafeWordProposeOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('connection.safeword.propose'),
  proposerPubkey: HexString(32),
  verifier: HexString(32),
  proposedAt: z.number().int().nonnegative(),
});
export type ConnectionSafeWordProposeOp = z.infer<typeof ConnectionSafeWordProposeOpSchema>;

/**
 * Roleplay-term handshake — confirm half. Sent by the partner once their
 * typed candidate matched the proposed verifier. Carries no word/verifier:
 * it just tells the proposer "we agree", and the proposer promotes their own
 * pending proposal to the active term. First-confirm-wins on the projector.
 */
export const ConnectionSafeWordConfirmOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('connection.safeword.confirm'),
  confirmerPubkey: HexString(32),
  confirmedAt: z.number().int().nonnegative(),
});
export type ConnectionSafeWordConfirmOp = z.infer<typeof ConnectionSafeWordConfirmOpSchema>;

/**
 * Manual "safe word used" signal. Add-only: the recipient INSERTs OR IGNOREs
 * keyed on id, surfacing an active alert until they acknowledge receipt.
 */
export const ConnectionSafeWordTriggerOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('connection.safeword.trigger'),
  id: z.string().uuid(),
  triggeredByPubkey: HexString(32),
  triggeredAt: z.number().int().nonnegative(),
});
export type ConnectionSafeWordTriggerOp = z.infer<typeof ConnectionSafeWordTriggerOpSchema>;

/**
 * Acknowledgement of a trigger. First-ack-wins: UPDATE acked_at WHERE id
 * matches and acked_at IS NULL; clears the active alert on both devices.
 */
export const ConnectionSafeWordAckOpSchema = z.object({
  v: z.literal(1),
  kind: z.literal('connection.safeword.ack'),
  id: z.string().uuid(),
  ackedByPubkey: HexString(32),
  ackedAt: z.number().int().nonnegative(),
});
export type ConnectionSafeWordAckOp = z.infer<typeof ConnectionSafeWordAckOpSchema>;

/** Cap on a single reflection answer — generous for a couple of
 *  paragraphs without letting one op fan out unbounded text. */
const REFLECTION_TEXT_MAX = 2000;

/**
 * Secret-note unlock loop (R7). A multi-step, two-party interaction:
 * the Unlocker draws a relationship prompt + completes a real-world
 * task; the Author (the secret's owner) verifies it, which draws ONE
 * random unrevealed secret and ships its body to the Unlocker; then
 * both partners reflect. Couple Points are awarded on verify and again
 * on mutual reflection (carried by ledger_entry.add).
 *
 * Privacy: the draw happens on the Author's device at verify time, and
 * the chosen `revealedNoteId` rides only this E2E op (never the relay
 * in clear, never a notification). The Author's UI withholds which note
 * was drawn until they open reflection — "blind until reflection" is a
 * UI contract, not a cryptographic one (a curious Author could read
 * their own local row). `.strict()` on every op locks the shape so a
 * future field can't smuggle the choice onto the wire unnoticed.
 *
 * Each op carries the actor's pubkey so the projector can enforce
 * actor == ratchet sender, exactly like role.set / saved_post.add.
 * State-transition ops key off `attemptId` and carry no own row id;
 * the `start` op is the add-only row-create and owns the attempt id.
 */
export const SecretUnlockStartOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('secret_unlock.start'),
    id: z.string().uuid(),
    /** Whose secret pool is being unlocked (the partner, from the
     *  Unlocker's POV). */
    authorPubkey: HexString(32),
    /** Who is doing the task — the actor; must equal the ratchet sender. */
    unlockerPubkey: HexString(32),
    /** Stable key into the static prompt library; text resolved on read. */
    promptKey: z.string().min(1).max(120),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type SecretUnlockStartOp = z.infer<typeof SecretUnlockStartOpSchema>;

export const SecretUnlockSubmitOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('secret_unlock.submit'),
    attemptId: z.string().uuid(),
    unlockerPubkey: HexString(32),
    submittedAt: z.number().int().nonnegative(),
  })
  .strict();
export type SecretUnlockSubmitOp = z.infer<typeof SecretUnlockSubmitOpSchema>;

/** Author "send-back": the task wasn't done to their satisfaction.
 *  Returns the attempt to the Unlocker to redo. Unlimited. */
export const SecretUnlockRejectOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('secret_unlock.reject'),
    attemptId: z.string().uuid(),
    authorPubkey: HexString(32),
    rejectedAt: z.number().int().nonnegative(),
  })
  .strict();
export type SecretUnlockRejectOp = z.infer<typeof SecretUnlockRejectOpSchema>;

/**
 * Author verifies the task AND reveals the drawn secret in one step.
 * Body + attachments are the secret's substance, shipped to the
 * Unlocker only here (mirrors note.secret.reveal — never on announce).
 * Body is optional so a media-only secret can be drawn.
 */
export const SecretUnlockVerifyOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('secret_unlock.verify'),
    attemptId: z.string().uuid(),
    authorPubkey: HexString(32),
    revealedNoteId: z.string().uuid(),
    body: z.string().min(1).max(NOTE_BODY_MAX).optional(),
    attachments: NoteAttachmentsSchema,
    verifiedAt: z.number().int().nonnegative(),
  })
  .strict();
export type SecretUnlockVerifyOp = z.infer<typeof SecretUnlockVerifyOpSchema>;

/** Unlocker abandons the attempt before the reveal. No points. */
export const SecretUnlockCancelOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('secret_unlock.cancel'),
    attemptId: z.string().uuid(),
    unlockerPubkey: HexString(32),
    canceledAt: z.number().int().nonnegative(),
  })
  .strict();
export type SecretUnlockCancelOp = z.infer<typeof SecretUnlockCancelOpSchema>;

/**
 * One partner's reflection on the revealed note. Add-only, keyed on
 * (attemptId, byPubkey) by the projector. The mutual-reflection award
 * fires once both partners' reflections exist (see ledger_entry.add).
 * `stars` is an optional 1–5 rating — cosmetic, never affects points.
 */
export const SecretUnlockReflectOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('secret_unlock.reflect'),
    attemptId: z.string().uuid(),
    byPubkey: HexString(32),
    appreciate: z.string().min(1).max(REFLECTION_TEXT_MAX),
    uncomfortable: z.string().min(1).max(REFLECTION_TEXT_MAX),
    stars: z.number().int().min(1).max(5).optional(),
    reflectedAt: z.number().int().nonnegative(),
  })
  .strict();
export type SecretUnlockReflectOp = z.infer<typeof SecretUnlockReflectOpSchema>;

/**
 * Connection termination (R8). Unilateral with a grace window: either
 * partner can schedule the sever; both devices then wipe all
 * connection-scoped data once `severAt` passes (a local, E2E action —
 * points and everything else are wiped, there is no server authority).
 * The initiator may `cancel` (undo) any time before `severAt`.
 *
 * Last-write-wins by ratchet order, like role.set: a later schedule
 * (e.g. "end now", `severAt = now`) supersedes an earlier one. Each op
 * carries `byPubkey` so the projector can enforce actor == ratchet
 * sender. No own id — the connection row IS the target.
 */
export const ConnectionSeverScheduleOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('connection.sever.schedule'),
    byPubkey: HexString(32),
    /** Unix seconds when the wipe becomes due (initiated + grace, or now). */
    severAt: z.number().int().nonnegative(),
  })
  .strict();
export type ConnectionSeverScheduleOp = z.infer<typeof ConnectionSeverScheduleOpSchema>;

/** Initiator-only undo of a pending sever (valid until `severAt`). */
export const ConnectionSeverCancelOpSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('connection.sever.cancel'),
    byPubkey: HexString(32),
    canceledAt: z.number().int().nonnegative(),
  })
  .strict();
export type ConnectionSeverCancelOp = z.infer<typeof ConnectionSeverCancelOpSchema>;

export const CrdtOpSchema = z.discriminatedUnion('kind', [
  SavedPostAddOpSchema,
  LedgerEntryAddOpSchema,
  NoteShareAddOpSchema,
  NoteSecretAnnounceOpSchema,
  NoteSecretRevealOpSchema,
  NotePublishOpSchema,
  ConnectionRoleSetOpSchema,
  ConnectionSafeWordProposeOpSchema,
  ConnectionSafeWordConfirmOpSchema,
  ConnectionSafeWordTriggerOpSchema,
  ConnectionSafeWordAckOpSchema,
  SecretUnlockStartOpSchema,
  SecretUnlockSubmitOpSchema,
  SecretUnlockRejectOpSchema,
  SecretUnlockVerifyOpSchema,
  SecretUnlockCancelOpSchema,
  SecretUnlockReflectOpSchema,
  ConnectionSeverScheduleOpSchema,
  ConnectionSeverCancelOpSchema,
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
