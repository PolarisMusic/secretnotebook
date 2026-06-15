import type {
  LedgerEntryAddOp,
  SecretUnlockCancelOp,
  SecretUnlockRejectOp,
  SecretUnlockReflectOp,
  SecretUnlockStartOp,
  SecretUnlockSubmitOp,
  SecretUnlockVerifyOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { descriptorFromRow, listNoteAttachments } from '../attachments/store';
import { randomUuidV4 } from '../connection-channel/uuid';
import { awardCouplePoints } from '../ledger/store';
import { drawPromptKey } from './prompts';

/** Couple Points awarded when the Author verifies the task. */
export const UNLOCK_VERIFY_POINTS = 500;
/** Couple Points awarded once BOTH partners have reflected. */
export const UNLOCK_REFLECT_POINTS = 500;
export const UNLOCK_REASON_VERIFY = 'unlock_verified';
export const UNLOCK_REASON_REFLECT = 'unlock_reflected';
/** Minimum unrevealed secrets the Author must hold for the Unlocker to
 *  start. ≥1 by product decision — with one or two secrets the Author can
 *  infer the draw, which is accepted (the choice is low-stakes flavour). */
export const MIN_SECRET_POOL = 1;

export type UnlockState = 'assigned' | 'submitted' | 'returned' | 'revealed' | 'canceled';

export interface SecretUnlockRow {
  id: string;
  /** Whose secret pool is being unlocked. */
  authorPubkey: Uint8Array;
  /** Who is doing the task. */
  unlockerPubkey: Uint8Array;
  promptKey: string;
  state: UnlockState;
  createdAt: number;
  submittedAt: number | null;
  returnedAt: number | null;
  verifiedAt: number | null;
  canceledAt: number | null;
  /** The secret drawn at verify time. NULL until then. On the Author's
   *  device this is set the instant they verify (they drew it) — the UI,
   *  not this row, is what keeps it blind until reflection. */
  revealedNoteId: string | null;
}

export interface UnlockReflectionRow {
  attemptId: string;
  byPubkey: Uint8Array;
  appreciate: string;
  uncomfortable: string;
  /** Optional 1–5 rating. Cosmetic — never affects points. */
  stars: number | null;
  reflectedAt: number;
}

interface RawUnlockRow {
  id: string;
  author_pubkey: Uint8Array | ArrayBufferLike;
  unlocker_pubkey: Uint8Array | ArrayBufferLike;
  prompt_key: string;
  state: UnlockState;
  created_at: number;
  submitted_at: number | null;
  returned_at: number | null;
  verified_at: number | null;
  canceled_at: number | null;
  revealed_note_id: string | null;
}

interface RawReflectionRow {
  attempt_id: string;
  by_pubkey: Uint8Array | ArrayBufferLike;
  appreciate: string;
  uncomfortable: string;
  stars: number | null;
  reflected_at: number;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function unlockRowOf(r: RawUnlockRow): SecretUnlockRow {
  return {
    id: r.id,
    authorPubkey: bytesFromRow(r.author_pubkey),
    unlockerPubkey: bytesFromRow(r.unlocker_pubkey),
    promptKey: r.prompt_key,
    state: r.state,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    returnedAt: r.returned_at,
    verifiedAt: r.verified_at,
    canceledAt: r.canceled_at,
    revealedNoteId: r.revealed_note_id,
  };
}

function reflectionRowOf(r: RawReflectionRow): UnlockReflectionRow {
  return {
    attemptId: r.attempt_id,
    byPubkey: bytesFromRow(r.by_pubkey),
    appreciate: r.appreciate,
    uncomfortable: r.uncomfortable,
    stars: r.stars,
    reflectedAt: r.reflected_at,
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const UNLOCK_SELECT = `id, author_pubkey, unlocker_pubkey, prompt_key, state,
                       created_at, submitted_at, returned_at, verified_at,
                       canceled_at, revealed_note_id`;

/** States in which the Unlocker is still working — used to enforce the
 *  one-active-attempt-per-partner rule and to gate cancel. */
const ACTIVE_STATES: readonly UnlockState[] = ['assigned', 'submitted', 'returned'];

/**
 * Host capabilities for the full unlock loop. `peerPubkey` is the
 * partner — the Author when this device is the Unlocker, and vice versa.
 * The enqueue accepts every op this store emits, including the
 * `ledger_entry.add` award op routed through awardCouplePoints.
 */
export interface SecretUnlockStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly peerPubkey: Uint8Array;
  readonly enqueue: (
    op:
      | SecretUnlockStartOp
      | SecretUnlockSubmitOp
      | SecretUnlockRejectOp
      | SecretUnlockVerifyOp
      | SecretUnlockCancelOp
      | SecretUnlockReflectOp
      | LedgerEntryAddOp,
  ) => Promise<void>;
  readonly now?: () => Date;
}

/**
 * Narrower deps for the reward paths (maybeAwardReflection /
 * reconcileUnlockRewards). They only ever write Couple-Points ops, so the
 * post-pull reconcile hook can satisfy this without the full store
 * surface. SecretUnlockStoreDeps is structurally compatible.
 */
export interface UnlockRewardDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly enqueue: (op: LedgerEntryAddOp) => Promise<void>;
  readonly now?: () => Date;
}

function nowSec(deps: { now?: () => Date }): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

async function getUnlockInternal(exec: SqlExecutor, id: string): Promise<SecretUnlockRow | null> {
  const rows = await exec.query<RawUnlockRow>(
    `SELECT ${UNLOCK_SELECT} FROM secret_unlock WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row ? unlockRowOf(row) : null;
}

async function countReflections(exec: SqlExecutor, attemptId: string): Promise<number> {
  const rows = await exec.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM secret_unlock_reflection WHERE attempt_id = ?`,
    [attemptId],
  );
  return rows[0]?.n ?? 0;
}

async function countActiveAsUnlocker(exec: SqlExecutor, unlocker: Uint8Array): Promise<number> {
  const rows = await exec.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM secret_unlock
      WHERE unlocker_pubkey = ?
        AND state IN ('assigned', 'submitted', 'returned')`,
    [unlocker],
  );
  return rows[0]?.n ?? 0;
}

/** How many unrevealed secret notes a given author still holds — the
 *  draw pool. Powers the start gate (≥ MIN_SECRET_POOL). */
export async function countUnrevealedSecretsBy(
  exec: SqlExecutor,
  authorPubkey: Uint8Array,
): Promise<number> {
  const rows = await exec.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM note
      WHERE kind = 'secret' AND author_pubkey = ? AND revealed_at IS NULL`,
    [authorPubkey],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Start an unlock attempt against the partner's secret pool. Draws a
 * random prompt now (recorded in the op so both devices converge without
 * re-drawing). Guards: the partner must hold ≥ MIN_SECRET_POOL unrevealed
 * secrets, and this device may have only one active attempt as Unlocker.
 */
export async function startUnlock(
  deps: SecretUnlockStoreDeps,
  opts: { rng?: () => number } = {},
): Promise<SecretUnlockRow> {
  const pool = await countUnrevealedSecretsBy(deps.exec, deps.peerPubkey);
  if (pool < MIN_SECRET_POOL) {
    throw new Error('startUnlock: partner has no secret notes to unlock');
  }
  if ((await countActiveAsUnlocker(deps.exec, deps.selfPubkey)) > 0) {
    throw new Error('startUnlock: you already have an active unlock in progress');
  }
  const id = await randomUuidV4();
  const promptKey = drawPromptKey(opts.rng);
  const createdAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    // Re-read inside the txn: two concurrent starts would both pass the
    // outer guard; the write lock makes this check consistent with the
    // INSERT so only one active attempt can exist.
    if ((await countActiveAsUnlocker(deps.exec, deps.selfPubkey)) > 0) return;
    await deps.exec.execute(
      `INSERT INTO secret_unlock (
         id, author_pubkey, unlocker_pubkey, prompt_key, state, created_at
       ) VALUES (?, ?, ?, ?, 'assigned', ?)`,
      [id, deps.peerPubkey, deps.selfPubkey, promptKey, createdAt],
    );
    await deps.enqueue({
      v: 1,
      kind: 'secret_unlock.start',
      id,
      authorPubkey: bytesToHex(deps.peerPubkey),
      unlockerPubkey: bytesToHex(deps.selfPubkey),
      promptKey,
      createdAt,
    });
  });
  return (await getUnlockInternal(deps.exec, id)) as SecretUnlockRow;
}

/** Unlocker marks the task done. assigned|returned → submitted. */
export async function submitUnlock(deps: SecretUnlockStoreDeps, attemptId: string): Promise<void> {
  const row = await requireParticipantRow(deps, attemptId, 'submitUnlock');
  if (!sameBytes(row.unlockerPubkey, deps.selfPubkey)) {
    throw new Error('submitUnlock: only the Unlocker can submit');
  }
  if (row.state !== 'assigned' && row.state !== 'returned') {
    if (row.state === 'submitted') return; // idempotent
    throw new Error(`submitUnlock: attempt is ${row.state}, not awaiting submission`);
  }
  const submittedAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    const fresh = await getUnlockInternal(deps.exec, attemptId);
    if (!fresh || (fresh.state !== 'assigned' && fresh.state !== 'returned')) return;
    await deps.exec.execute(
      `UPDATE secret_unlock SET state = 'submitted', submitted_at = ?
        WHERE id = ? AND state IN ('assigned', 'returned')`,
      [submittedAt, attemptId],
    );
    await deps.enqueue({
      v: 1,
      kind: 'secret_unlock.submit',
      attemptId,
      unlockerPubkey: bytesToHex(deps.selfPubkey),
      submittedAt,
    });
  });
}

/** Author send-back: the task wasn't done well enough. submitted →
 *  returned, so the Unlocker can try again. Unlimited. */
export async function rejectUnlock(deps: SecretUnlockStoreDeps, attemptId: string): Promise<void> {
  const row = await requireParticipantRow(deps, attemptId, 'rejectUnlock');
  if (!sameBytes(row.authorPubkey, deps.selfPubkey)) {
    throw new Error('rejectUnlock: only the Author can send a task back');
  }
  if (row.state !== 'submitted') {
    throw new Error(`rejectUnlock: attempt is ${row.state}, not awaiting verification`);
  }
  const rejectedAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    const fresh = await getUnlockInternal(deps.exec, attemptId);
    if (!fresh || fresh.state !== 'submitted') return;
    await deps.exec.execute(
      `UPDATE secret_unlock SET state = 'returned', returned_at = ?
        WHERE id = ? AND state = 'submitted'`,
      [rejectedAt, attemptId],
    );
    await deps.enqueue({
      v: 1,
      kind: 'secret_unlock.reject',
      attemptId,
      authorPubkey: bytesToHex(deps.selfPubkey),
      rejectedAt,
    });
  });
}

/**
 * Author verifies the task. This is where the blind draw happens: pick
 * one random unrevealed secret from the Author's own pool, ship its body
 * (and any media) to the Unlocker via the verify op, and move the attempt
 * to `revealed`. The Author's own note row is deliberately NOT revealed
 * here — that waits for discloseRevealedNoteToAuthor at reflection time.
 *
 * The verify Couple-Points award is written right after the state txn
 * (awardCouplePoints opens its own transaction, so it can't nest). The
 * tiny window between the two is covered by reconcileUnlockRewards.
 */
export async function verifyUnlock(
  deps: SecretUnlockStoreDeps,
  attemptId: string,
  opts: { rng?: () => number } = {},
): Promise<{ revealedNoteId: string }> {
  const row = await requireParticipantRow(deps, attemptId, 'verifyUnlock');
  if (!sameBytes(row.authorPubkey, deps.selfPubkey)) {
    throw new Error('verifyUnlock: only the Author can verify');
  }
  if (row.state !== 'submitted') {
    throw new Error(`verifyUnlock: attempt is ${row.state}, not awaiting verification`);
  }

  // Draw pool: the Author's own unrevealed secrets, minus any already
  // drawn by another attempt (belt-and-braces — the one-active-per-partner
  // rule should already prevent a second draw against this pool).
  const candidates = await deps.exec.query<{ id: string; body: string | null }>(
    `SELECT id, body FROM note
      WHERE kind = 'secret' AND author_pubkey = ? AND revealed_at IS NULL
        AND id NOT IN (
          SELECT revealed_note_id FROM secret_unlock
           WHERE revealed_note_id IS NOT NULL
        )
      ORDER BY id ASC`,
    [deps.selfPubkey],
  );
  if (candidates.length === 0) {
    throw new Error('verifyUnlock: no secret available to reveal');
  }
  const rng = opts.rng ?? Math.random;
  const idx = Math.min(Math.floor(rng() * candidates.length), candidates.length - 1);
  const pick = candidates[idx];
  if (!pick) throw new Error('verifyUnlock: no secret available to reveal');
  const attachmentRows = await listNoteAttachments(deps.exec, pick.id);
  const descriptors = attachmentRows.map(descriptorFromRow);

  const verifiedAt = nowSec(deps);
  let transitioned = false;
  await deps.exec.transaction(async () => {
    const fresh = await getUnlockInternal(deps.exec, attemptId);
    if (!fresh || fresh.state !== 'submitted') return;
    await deps.exec.execute(
      `UPDATE secret_unlock
          SET state = 'revealed', verified_at = ?, revealed_note_id = ?
        WHERE id = ? AND state = 'submitted'`,
      [verifiedAt, pick.id, attemptId],
    );
    await deps.enqueue({
      v: 1,
      kind: 'secret_unlock.verify',
      attemptId,
      authorPubkey: bytesToHex(deps.selfPubkey),
      revealedNoteId: pick.id,
      ...(pick.body != null ? { body: pick.body } : {}),
      ...(descriptors.length > 0 ? { attachments: descriptors } : {}),
      verifiedAt,
    });
    transitioned = true;
  });

  if (transitioned) {
    await awardCouplePoints(deps, {
      delta: UNLOCK_VERIFY_POINTS,
      reason: UNLOCK_REASON_VERIFY,
      refId: attemptId,
    });
  }
  return { revealedNoteId: pick.id };
}

/** Unlocker abandons before the reveal. active → canceled. No points. */
export async function cancelUnlock(deps: SecretUnlockStoreDeps, attemptId: string): Promise<void> {
  const row = await requireParticipantRow(deps, attemptId, 'cancelUnlock');
  if (!sameBytes(row.unlockerPubkey, deps.selfPubkey)) {
    throw new Error('cancelUnlock: only the Unlocker can cancel');
  }
  if (!ACTIVE_STATES.includes(row.state)) {
    if (row.state === 'canceled') return; // idempotent
    throw new Error(`cancelUnlock: attempt is ${row.state}, too late to cancel`);
  }
  const canceledAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    const fresh = await getUnlockInternal(deps.exec, attemptId);
    if (!fresh || !ACTIVE_STATES.includes(fresh.state)) return;
    await deps.exec.execute(
      `UPDATE secret_unlock SET state = 'canceled', canceled_at = ?
        WHERE id = ? AND state IN ('assigned', 'submitted', 'returned')`,
      [canceledAt, attemptId],
    );
    await deps.enqueue({
      v: 1,
      kind: 'secret_unlock.cancel',
      attemptId,
      unlockerPubkey: bytesToHex(deps.selfPubkey),
      canceledAt,
    });
  });
}

/**
 * Reveal the drawn note to the Author (local only — the Unlocker already
 * has it from the verify op). Called when the Author opens reflection;
 * stamps the note's revealed_at so it leaves the pool and the Author can
 * read what was unlocked. Idempotent.
 */
export async function discloseRevealedNoteToAuthor(
  deps: SecretUnlockStoreDeps,
  attemptId: string,
): Promise<void> {
  const row = await getUnlockInternal(deps.exec, attemptId);
  if (!row) throw new Error(`discloseRevealedNoteToAuthor: no attempt ${attemptId}`);
  if (!sameBytes(row.authorPubkey, deps.selfPubkey)) {
    throw new Error('discloseRevealedNoteToAuthor: only the Author discloses');
  }
  if (row.revealedNoteId == null) return;
  await deps.exec.execute(
    `UPDATE note SET revealed_at = ?
      WHERE id = ? AND revealed_at IS NULL`,
    [row.verifiedAt ?? nowSec(deps), row.revealedNoteId],
  );
}

/**
 * Record this device's reflection on the revealed note. Either partner
 * may call it once the attempt is `revealed`. Idempotent per partner
 * (one reflection each). When the Author reflects, it tries the mutual
 * award immediately; when the Unlocker reflects, the award is left to the
 * Author's reconcile pass (only the Author writes Couple Points).
 */
export async function reflectOnUnlock(
  deps: SecretUnlockStoreDeps,
  attemptId: string,
  input: { appreciate: string; uncomfortable: string; stars?: number },
): Promise<void> {
  const row = await requireParticipantRow(deps, attemptId, 'reflectOnUnlock');
  if (row.state !== 'revealed') {
    throw new Error(`reflectOnUnlock: attempt is ${row.state}, nothing revealed to reflect on`);
  }
  const appreciate = input.appreciate.trim();
  const uncomfortable = input.uncomfortable.trim();
  if (appreciate.length === 0 || uncomfortable.length === 0) {
    throw new Error('reflectOnUnlock: both reflection answers are required');
  }
  if (
    input.stars != null &&
    (input.stars < 1 || input.stars > 5 || !Number.isInteger(input.stars))
  ) {
    throw new Error('reflectOnUnlock: stars must be an integer 1–5');
  }
  if (await getReflectionBy(deps.exec, attemptId, deps.selfPubkey)) return; // already reflected

  const reflectedAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    if (await getReflectionBy(deps.exec, attemptId, deps.selfPubkey)) return;
    await deps.exec.execute(
      `INSERT OR IGNORE INTO secret_unlock_reflection (
         attempt_id, by_pubkey, appreciate, uncomfortable, stars, reflected_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [attemptId, deps.selfPubkey, appreciate, uncomfortable, input.stars ?? null, reflectedAt],
    );
    await deps.enqueue({
      v: 1,
      kind: 'secret_unlock.reflect',
      attemptId,
      byPubkey: bytesToHex(deps.selfPubkey),
      appreciate,
      uncomfortable,
      ...(input.stars != null ? { stars: input.stars } : {}),
      reflectedAt,
    });
  });

  // Only the Author writes the award; if this device is the Author and
  // the partner already reflected, fire it now for a snappy +500.
  if (sameBytes(deps.selfPubkey, row.authorPubkey)) {
    await maybeAwardReflection(deps, attemptId);
  }
}

/**
 * Award the mutual-reflection Couple Points iff this device is the
 * Author of the attempt and both partners have reflected. Idempotent via
 * awardCouplePoints' (reason, refId) guard.
 */
export async function maybeAwardReflection(
  deps: UnlockRewardDeps,
  attemptId: string,
): Promise<void> {
  const row = await getUnlockInternal(deps.exec, attemptId);
  if (!row) return;
  if (!sameBytes(row.authorPubkey, deps.selfPubkey)) return; // only the Author awards
  if ((await countReflections(deps.exec, attemptId)) < 2) return;
  await awardCouplePoints(deps, {
    delta: UNLOCK_REFLECT_POINTS,
    reason: UNLOCK_REASON_REFLECT,
    refId: attemptId,
  });
}

/**
 * Post-pull safety net. The projector applies the partner's reflect /
 * verify ops but cannot enqueue (no outbox access), so the Author's
 * device reconciles its Couple-Points awards here: for every attempt it
 * authored that has reached `revealed`, ensure the verify award exists
 * and fire the reflection award once both reflections are in. Both writes
 * are idempotent, so running this every cycle is cheap and self-healing.
 */
export async function reconcileUnlockRewards(deps: UnlockRewardDeps): Promise<void> {
  const rows = await deps.exec.query<{ id: string }>(
    `SELECT id FROM secret_unlock WHERE author_pubkey = ? AND state = 'revealed'`,
    [deps.selfPubkey],
  );
  for (const { id } of rows) {
    await awardCouplePoints(deps, {
      delta: UNLOCK_VERIFY_POINTS,
      reason: UNLOCK_REASON_VERIFY,
      refId: id,
    });
    await maybeAwardReflection(deps, id);
  }
}

// --- read helpers (powering the UI) ---

export async function getUnlock(exec: SqlExecutor, id: string): Promise<SecretUnlockRow | null> {
  return getUnlockInternal(exec, id);
}

/** Every attempt this device is part of (either role), newest first. */
export async function listUnlocksFor(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<SecretUnlockRow[]> {
  const rows = await exec.query<RawUnlockRow>(
    `SELECT ${UNLOCK_SELECT} FROM secret_unlock
      WHERE author_pubkey = ? OR unlocker_pubkey = ?
      ORDER BY created_at DESC, id DESC`,
    [selfPubkey, selfPubkey],
  );
  return rows.map(unlockRowOf);
}

export async function listReflections(
  exec: SqlExecutor,
  attemptId: string,
): Promise<UnlockReflectionRow[]> {
  const rows = await exec.query<RawReflectionRow>(
    `SELECT attempt_id, by_pubkey, appreciate, uncomfortable, stars, reflected_at
       FROM secret_unlock_reflection WHERE attempt_id = ?
      ORDER BY reflected_at ASC`,
    [attemptId],
  );
  return rows.map(reflectionRowOf);
}

export async function getReflectionBy(
  exec: SqlExecutor,
  attemptId: string,
  byPubkey: Uint8Array,
): Promise<UnlockReflectionRow | null> {
  const rows = await exec.query<RawReflectionRow>(
    `SELECT attempt_id, by_pubkey, appreciate, uncomfortable, stars, reflected_at
       FROM secret_unlock_reflection WHERE attempt_id = ? AND by_pubkey = ?`,
    [attemptId, byPubkey],
  );
  const row = rows[0];
  return row ? reflectionRowOf(row) : null;
}

/** True once both partners have reflected — the loop is complete. */
export async function isReflectionComplete(exec: SqlExecutor, attemptId: string): Promise<boolean> {
  return (await countReflections(exec, attemptId)) >= 2;
}

async function requireParticipantRow(
  deps: SecretUnlockStoreDeps,
  attemptId: string,
  fn: string,
): Promise<SecretUnlockRow> {
  const row = await getUnlockInternal(deps.exec, attemptId);
  if (!row) throw new Error(`${fn}: no attempt ${attemptId}`);
  const isParticipant =
    sameBytes(row.authorPubkey, deps.selfPubkey) || sameBytes(row.unlockerPubkey, deps.selfPubkey);
  if (!isParticipant) throw new Error(`${fn}: not a participant in attempt ${attemptId}`);
  return row;
}
