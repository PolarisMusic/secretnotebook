import type { CrdtOp } from '@secretnotebook/connection-protocol';

import type { ApiClient } from '../api/client';
import type { SqlExecutor } from '../../db/executor';
import { requireCurrentEntitlement } from '../iap/store';
import { publishNote, type PublishNoteResult } from './store';

/**
 * Canonical production-side wiring for publishing a note. Bundles
 * three independently-tested capabilities so UI code can't forget any
 * of them:
 *
 *   - the R5 IAP entitlement gate (requireCurrentEntitlement). If the
 *     device has no cached receipt or it's expired, the helper throws
 *     before any state changes — the EntitlementError surfaces to the
 *     UI which translates `code` to the paywall message.
 *   - the R3 server publish call (apiClient.submitPost) wrapped to
 *     match the PublishToGlobalFeed contract.
 *   - the R2 author-only / body-required / idempotent local
 *     stamping logic inside publishNote.
 *
 * The helper exists specifically so future UI cannot construct a
 * publishNote call by hand and accidentally omit `requireEntitlement`.
 * Anything in the app that publishes should route through here.
 */

/**
 * What's needed from the host. Pull these from the corresponding
 * Zustand stores at the route level:
 *   exec      <- useDatabaseStore
 *   engine    <- useSyncEngineStore
 *   apiClient <- useApiStore
 */
export interface PublishMyNoteDeps {
  readonly exec: SqlExecutor;
  /** SyncEngine is the source of both `selfPub` (whose bytes the
   *  note row's author_pubkey must match) and `enqueue` (which puts
   *  the resulting note.publish op on the connection's outbox). We
   *  take the whole engine rather than picking those off ahead of
   *  time so the helper survives engine identity changes (e.g. a
   *  severing-then-rebuild cycle in a future slice). */
  readonly engine: {
    readonly selfPub: Uint8Array;
    readonly enqueue: ApiCompatibleEnqueue;
  };
  readonly apiClient: Pick<ApiClient, 'submitPost'>;
  /** Mostly for tests — defaults to `new Date()`. */
  readonly now?: () => Date;
}

// SyncEngine.enqueue's signature: accepts the full CrdtOp union.
// We type this against CrdtOp (not the engine class) so the helper
// composes with any object exposing the same shape — tests stub it
// without spinning up a real engine. Function parameters are
// contravariant in TS, so a function accepting CrdtOp slots
// cleanly into publishNote's narrower note-op union expectation.
type ApiCompatibleEnqueue = (op: CrdtOp) => Promise<void>;

export async function publishMyNote(
  deps: PublishMyNoteDeps,
  noteId: string,
  opts: { contentType?: 'text' | 'link' } = {},
): Promise<PublishNoteResult> {
  return publishNote(
    {
      exec: deps.exec,
      selfPubkey: deps.engine.selfPub,
      now: deps.now,
      enqueue: deps.engine.enqueue,
    },
    noteId,
    async (input) => {
      // apiClient.submitPost returns { id, createdAt }; we only
      // surface the id (publishNote stamps the local row's
      // publishedAt from its own clock so the field stays
      // consistent with the rest of the outbox/op timestamps).
      const { id } = await deps.apiClient.submitPost(input);
      return { id };
    },
    {
      contentType: opts.contentType,
      requireEntitlement: async () => {
        await requireCurrentEntitlement(deps.exec, deps.now);
      },
    },
  );
}
