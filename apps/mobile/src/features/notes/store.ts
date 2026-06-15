import type {
  NotePublishOp,
  NoteSecretAnnounceOp,
  NoteSecretRevealOp,
  NoteShareAddOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from '../connection-channel/uuid';

export type NoteKind = 'shared' | 'secret';

export interface NoteRow {
  id: string;
  kind: NoteKind;
  authorPubkey: Uint8Array;
  /** NULL for secret notes that have been announced but not yet
   *  revealed to this device. Always non-NULL for shared notes and
   *  for the author's own secrets. */
  body: string | null;
  createdAt: number;
  /** Set once a reveal op has been applied. Stays NULL on the
   *  author's local row until they call revealSecretNote(). */
  revealedAt: number | null;
  /** Set once the note has been promoted to a public post via
   *  publishNote. NULL means "still private to this connection." */
  publishedAt: number | null;
  /** UUID of the resulting public post on the global feed.
   *  Co-NULL with publishedAt. */
  publishedGlobalPostId: string | null;
}

interface RawNoteRow {
  id: string;
  kind: NoteKind;
  author_pubkey: Uint8Array | ArrayBufferLike;
  body: string | null;
  created_at: number;
  revealed_at: number | null;
  published_at: number | null;
  published_global_post_id: string | null;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function rowOf(r: RawNoteRow): NoteRow {
  return {
    id: r.id,
    kind: r.kind,
    authorPubkey: bytesFromRow(r.author_pubkey),
    body: r.body,
    createdAt: r.created_at,
    revealedAt: r.revealed_at,
    publishedAt: r.published_at,
    publishedGlobalPostId: r.published_global_post_id,
  };
}

const NOTE_SELECT = `id, kind, author_pubkey, body, created_at, revealed_at,
                     published_at, published_global_post_id`;

/**
 * Anything the note store needs from the host: SQL access for the
 * local row, the author's pubkey to stamp the op with, an enqueue
 * function to push it onto the sync outbox, and a clock so tests
 * can pin createdAt.
 *
 * Kept narrower than `SyncEngine` so the store doesn't pick up an
 * incidental dependency on flush/pull — anything that satisfies
 * `enqueue` will do, including a noop spy for unit tests.
 */
export interface NoteStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly enqueue: (
    op: NoteShareAddOp | NoteSecretAnnounceOp | NoteSecretRevealOp | NotePublishOp,
  ) => Promise<void>;
  readonly now?: () => Date;
}

/**
 * Caller-supplied capability for promoting a note to a public post.
 * The store keeps publish out of its own dependency graph so the unit
 * tests don't need an ApiClient — the production wiring passes
 * `(input) => apiClient.submitPost(input)`, the tests pass a
 * jest.fn() that returns a canned id.
 */
export type PublishToGlobalFeed = (input: {
  contentType: 'text' | 'link';
  body: string;
  audience: 'everyone' | 'masculine' | 'feminine';
}) => Promise<{ id: string }>;

export interface PublishNoteResult {
  /** id of the resulting public post. Same value lands in
   *  row.publishedGlobalPostId after the projector applies the op. */
  globalPostId: string;
  /** Wall-clock seconds stamped on the row + propagated to the
   *  partner via the publish op. */
  publishedAt: number;
}

function nowSec(deps: NoteStoreDeps): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

async function getNoteInternal(exec: SqlExecutor, id: string): Promise<NoteRow | null> {
  const rows = await exec.query<RawNoteRow>(`SELECT ${NOTE_SELECT} FROM note WHERE id = ?`, [id]);
  const row = rows[0];
  return row ? rowOf(row) : null;
}

/**
 * Create a shared note. Body travels with the announce op so the
 * partner sees the substance as soon as the op is applied.
 *
 * Local row is written + outbox op enqueued inside one transaction
 * so a crash between the two can't leave a row the partner will
 * never hear about (or vice versa: an op for a row that doesn't
 * exist locally).
 */
export async function writeSharedNote(deps: NoteStoreDeps, body: string): Promise<NoteRow> {
  if (body.length === 0) throw new Error('writeSharedNote: body required');
  const id = await randomUuidV4();
  const createdAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `INSERT INTO note (id, kind, author_pubkey, body, created_at)
       VALUES (?, 'shared', ?, ?, ?)`,
      [id, deps.selfPubkey, body, createdAt],
    );
    await deps.enqueue({
      v: 1,
      kind: 'note.share.add',
      id,
      authorPubkey: bytesToHex(deps.selfPubkey),
      body,
      createdAt,
    });
  });
  // Row was just inserted; cast away the null.
  return (await getNoteInternal(deps.exec, id)) as NoteRow;
}

/**
 * Create a secret note. Body lands in the LOCAL row immediately
 * (author always knows their own secret) but the outgoing op only
 * announces existence — id, author, createdAt. The body stays off
 * the wire until the author calls revealSecretNote().
 *
 * Same transaction story as writeSharedNote.
 */
export async function writeSecretNote(deps: NoteStoreDeps, body: string): Promise<NoteRow> {
  if (body.length === 0) throw new Error('writeSecretNote: body required');
  const id = await randomUuidV4();
  const createdAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `INSERT INTO note (id, kind, author_pubkey, body, created_at)
       VALUES (?, 'secret', ?, ?, ?)`,
      [id, deps.selfPubkey, body, createdAt],
    );
    await deps.enqueue({
      v: 1,
      kind: 'note.secret.announce',
      id,
      authorPubkey: bytesToHex(deps.selfPubkey),
      createdAt,
    });
  });
  return (await getNoteInternal(deps.exec, id)) as NoteRow;
}

/**
 * Publish the body of a previously-announced secret note. Only the
 * author can call this meaningfully — if the local row's body is
 * NULL (partner-side, pre-reveal), there's nothing to publish and
 * the call throws.
 *
 * Idempotent: a second call on an already-revealed row is a no-op
 * (no UPDATE, no enqueue). That matters because UI surfaces can
 * fire the action twice on a slow connection without flooding the
 * outbox with redundant reveal ops.
 */
export async function revealSecretNote(deps: NoteStoreDeps, id: string): Promise<void> {
  const row = await getNoteInternal(deps.exec, id);
  if (!row) throw new Error(`revealSecretNote: no note with id ${id}`);
  if (row.kind !== 'secret') throw new Error(`revealSecretNote: note ${id} is not secret`);
  if (row.body == null) {
    throw new Error(`revealSecretNote: cannot reveal a note whose body is not local`);
  }
  if (row.revealedAt != null) return; // already revealed → idempotent no-op
  const revealedAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    // R6.3: re-read inside the txn before deciding to enqueue. Two
    // concurrent calls would both pass the outer guard at line 195;
    // without this re-check the second's UPDATE would no-op via
    // WHERE revealed_at IS NULL, but the enqueue would still fire,
    // putting a duplicate reveal op on the wire. The re-read is
    // consistent with the UPDATE because the surrounding
    // transaction holds a write lock for the whole sequence.
    const fresh = await getNoteInternal(deps.exec, id);
    if (fresh?.revealedAt != null) return;
    await deps.exec.execute(
      `UPDATE note SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL`,
      [revealedAt, id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'note.secret.reveal',
      id,
      body: row.body as string,
      revealedAt,
    });
  });
}

/** Newest first, both kinds. Powers the (forthcoming) Notes screen. */
export async function listNotes(exec: SqlExecutor): Promise<NoteRow[]> {
  const rows = await exec.query<RawNoteRow>(
    `SELECT ${NOTE_SELECT}
       FROM note
      ORDER BY created_at DESC, id DESC`,
  );
  return rows.map(rowOf);
}

/**
 * Promote a note to a public post on the global feed. Author-only:
 * the local row's `author_pubkey` must equal `deps.selfPubkey`,
 * since the publisher's anon-author identity is the one stamped on
 * the resulting public post (server-side); allowing the partner to
 * publish would split the authorship across people in a way that
 * the public-feed UI can't reflect.
 *
 * Sequence:
 *   1. Validate locally — body filled, not yet published, I'm the
 *      author.
 *   2. Call publishToGlobalFeed OUTSIDE any DB transaction. The
 *      network call may take seconds; holding a write lock for it
 *      blocks the rest of the engine and starves the outbox/pull
 *      cycle. If the server rejects, throw — local state untouched.
 *   3. On success, run the local UPDATE + outbox enqueue INSIDE a
 *      transaction. The server has already accepted the post by the
 *      time we get here; the only failures left are local I/O,
 *      which are caught by the txn rollback so the row stays
 *      consistent.
 *
 * Recovery story for the "POST succeeded but local txn failed"
 * gap: the resulting public post is still on the server and
 * visible to everyone; the local note row just won't show the
 * "published" marker. The user can re-call publishNote — the
 * server's `posts` table has a UNIQUE constraint on `body_hash`
 * and `insertOrGetByBodyHash` returns the existing row on
 * conflict, so the retry round-trips to the SAME global_post_id
 * and the local UPDATE lands cleanly. The only edge case left:
 * if the IAP entitlement lapsed between the failed call and the
 * retry, the gate throws and the user has a public post they
 * can't link to locally. Fix needs a UI surface that lets the
 * user re-stamp without re-publishing; deferred.
 *
 * Idempotent in the success path: a second call after
 * published_at is set returns the existing globalPostId without a
 * new POST or op.
 */
export async function publishNote(
  deps: NoteStoreDeps,
  id: string,
  publishToGlobalFeed: PublishToGlobalFeed,
  opts: {
    contentType?: 'text' | 'link';
    /** Author-tagged audience for the global feed; defaults to 'everyone'. */
    audience?: 'everyone' | 'masculine' | 'feminine';
    /** Resolves when the device has a current IAP entitlement,
     *  throws otherwise (paywall surface). Optional so unit tests
     *  that don't care about the gate can pass nothing; the
     *  production wiring passes
     *  `() => requireCurrentEntitlement(exec).then(() => undefined)`. */
    requireEntitlement?: () => Promise<void>;
  } = {},
): Promise<PublishNoteResult> {
  const row = await getNoteInternal(deps.exec, id);
  if (!row) throw new Error(`publishNote: no note with id ${id}`);
  if (row.publishedAt != null && row.publishedGlobalPostId != null) {
    // Idempotent re-call short-circuits before the entitlement
    // check too — if a note is already public, surfacing the
    // existing post id should not depend on the user's current
    // subscription state.
    return { globalPostId: row.publishedGlobalPostId, publishedAt: row.publishedAt };
  }
  if (row.body == null) {
    throw new Error(`publishNote: cannot publish a note whose body is not local`);
  }
  // Author-only: byte-compare local self-pubkey to the row's author.
  if (!sameBytes(row.authorPubkey, deps.selfPubkey)) {
    throw new Error(`publishNote: only the author can publish their own note`);
  }
  // R5 paywall: if a gate is supplied, it must resolve before we
  // hit the server. A throw here propagates to the caller and
  // local state stays untouched.
  if (opts.requireEntitlement) {
    await opts.requireEntitlement();
  }

  // R6.2: if this is a secret note that hasn't been revealed yet,
  // auto-reveal first. Publishing a note to the global feed is
  // strictly more public than revealing it to the partner, so
  // there's no consent leak — but without this step the partner
  // would receive a `note.publish` op on a row whose body is still
  // NULL (the announce went through, the reveal never did), and
  // they'd see a "published" note with no substance locally. The
  // reveal op + publish op then ride the ratchet in order so the
  // partner's projector first fills the body, then stamps
  // published_*. Idempotent: revealSecretNote short-circuits if
  // already revealed, so calling this on a shared note or an
  // already-revealed secret is a no-op.
  if (row.kind === 'secret' && row.revealedAt == null) {
    await revealSecretNote(deps, id);
  }

  const { id: globalPostId } = await publishToGlobalFeed({
    contentType: opts.contentType ?? 'text',
    body: row.body,
    audience: opts.audience ?? 'everyone',
  });

  const publishedAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    // R6.3: re-read inside the txn so a racing concurrent call
    // doesn't enqueue a duplicate publish op. Without this, two
    // concurrent publishNote(id) calls would both pass the outer
    // `published_at != null` guard, both POST (server dedups by
    // body_hash → same id), both enter txn; second UPDATE no-ops
    // via WHERE but enqueue fires unconditionally. The re-read is
    // consistent with the UPDATE because the txn holds a write
    // lock for the whole sequence.
    const fresh = await getNoteInternal(deps.exec, id);
    if (fresh?.publishedAt != null) return;
    await deps.exec.execute(
      `UPDATE note
          SET published_at             = ?,
              published_global_post_id = ?
        WHERE id                       = ?
          AND published_at IS NULL`,
      [publishedAt, globalPostId, id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'note.publish',
      id,
      publishedGlobalPostId: globalPostId,
      publishedAt,
    });
  });

  return { globalPostId, publishedAt };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function getNote(exec: SqlExecutor, id: string): Promise<NoteRow | null> {
  return getNoteInternal(exec, id);
}
