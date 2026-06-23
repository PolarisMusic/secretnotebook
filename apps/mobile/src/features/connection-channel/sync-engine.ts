import {
  computeBlindedRecipientIdHex,
  deserialiseOp,
  ratchetDecrypt,
  ratchetEncrypt,
  serialiseOp,
  type CrdtOp,
} from '@secretnotebook/connection-protocol';
import { base64ToBytes, bytesToBase64 } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import type { ApiClient } from '../api/client';
import { loadRatchet, saveRatchet } from './ratchet-store';
import { bumpOutboxAttempt, deleteOutbox, enqueueOutbox, readPendingOutbox } from './outbox';
import { applyCrdtOp } from './projector';
import { envelopeHash, isEnvelopeSeen, markEnvelopeSeen } from './seen';
import { randomUuidV4 } from './uuid';

/**
 * Wire shape stored in `sync_outbox.envelope`. The op is plaintext on
 * disk (SQLCipher protects at rest) so a partial send can be retried
 * without recovering ratchet state — the engine encrypts at POST time
 * and persists the bumped ratchet immediately afterward.
 */
interface OutboxPayload {
  v: 1;
  op: CrdtOp;
}

function packOutbox(op: CrdtOp): string {
  return JSON.stringify({ v: 1, op } satisfies OutboxPayload);
}

function unpackOutbox(text: string): CrdtOp {
  const parsed = JSON.parse(text) as OutboxPayload;
  // Re-validate through serialiseOp so a row written by an older build
  // can't smuggle a malformed op past the type system.
  return deserialiseOp(serialiseOp(parsed.op));
}

export interface SyncEngineDeps {
  readonly exec: SqlExecutor;
  readonly api: ApiClient;
  readonly connectionId: string;
  readonly connectionRoot: Uint8Array;
  readonly selfPub: Uint8Array;
  readonly peerPub: Uint8Array;
  /** Mostly for tests — defaults to `new Date()`. */
  readonly now?: () => Date;
  /**
   * Backoff delay for a failed POST, in milliseconds. The engine bumps
   * `next_attempt_at = now + retryBackoffMs * attempts`. Default 30 s.
   */
  readonly retryBackoffMs?: number;
  /** Page size for the relay GET. Default 100 (the server cap). */
  readonly pollLimit?: number;
  /**
   * How many *previous* UTC days to also poll on each pull, on top of
   * today. The blinded inbox id rotates per UTC day, so a note addressed
   * just before a UTC-midnight rollover (or while this device was offline
   * across one) lands in a day bucket the receiver would otherwise never
   * look at. Default 2 (today + 2 prior days).
   */
  readonly pullLookbackDays?: number;
}

export interface FlushResult {
  attempted: number;
  delivered: number;
  failed: number;
}

export interface PullResult {
  fetched: number;
  applied: number;
  duplicates: number;
}

/**
 * The connection-channel sync engine. Stateless across method calls — every
 * operation reads the persisted ratchet, mutates it, and writes it back
 * within a transaction so a partial crash leaves a consistent state.
 *
 * The engine owns three I/O surfaces:
 *   - sync_outbox: queue of CRDT ops to send. enqueue() appends, flush()
 *     drains.
 *   - the relay endpoints (POST/GET/DELETE /v1/relay/inbox/:blindedId)
 *     via the shared ApiClient.
 *   - sync_seen: per-envelope dedup set, keyed on sha256(header ‖ ct).
 *
 * Phase-1 scope: no DH ratchet, no key bundles, no background polling.
 * Callers (the eventual react-native-background-fetch wiring) invoke
 * flush() + pull() on a timer.
 */
export class SyncEngine {
  private readonly now: () => Date;
  private readonly retryBackoffMs: number;
  private readonly pollLimit: number;
  private readonly pullLookbackDays: number;

  constructor(private readonly deps: SyncEngineDeps) {
    this.now = deps.now ?? ((): Date => new Date());
    this.retryBackoffMs = deps.retryBackoffMs ?? 30_000;
    this.pollLimit = deps.pollLimit ?? 100;
    this.pullLookbackDays = deps.pullLookbackDays ?? 2;
  }

  /** Read-only views on the deps the screens need. */
  get selfPub(): Uint8Array {
    return this.deps.selfPub;
  }
  get peerPub(): Uint8Array {
    return this.deps.peerPub;
  }
  get connectionId(): string {
    return this.deps.connectionId;
  }
  get connectionRoot(): Uint8Array {
    return this.deps.connectionRoot;
  }
  get exec(): SqlExecutor {
    return this.deps.exec;
  }

  /** Append a CRDT op to the outbox. Visible to flush() on the next tick. */
  async enqueue(op: CrdtOp): Promise<void> {
    await enqueueOutbox(this.deps.exec, {
      id: await randomUuidV4(),
      envelope: packOutbox(op),
      recipientPubkey: this.deps.peerPub,
      nextAttemptAt: Math.floor(this.now().getTime() / 1000),
    });
  }

  /**
   * Drain every outbox row whose timer has elapsed. For each row:
   *   - load the ratchet, encrypt, save the bumped ratchet, POST.
   *   - on success: delete the outbox row.
   *   - on POST failure: bump attempts + next_attempt_at and leave the
   *     row for the next cycle. The encrypted bytes are NOT cached —
   *     we re-encrypt on retry, which advances the ratchet again. That
   *     means a duplicated POST can never collide on the receiver side
   *     because each retry consumes a fresh counter.
   */
  async flush(): Promise<FlushResult> {
    const nowSec = Math.floor(this.now().getTime() / 1000);
    const pending = await readPendingOutbox(this.deps.exec, nowSec);
    let delivered = 0;
    let failed = 0;
    for (const row of pending) {
      const op = unpackOutbox(row.envelope);
      try {
        await this.encryptAndSend(op);
        await deleteOutbox(this.deps.exec, row.id);
        delivered += 1;
      } catch {
        const nextAttempt = nowSec + Math.floor((this.retryBackoffMs * (row.attempts + 1)) / 1000);
        await bumpOutboxAttempt(this.deps.exec, { id: row.id, nextAttemptAt: nextAttempt });
        failed += 1;
      }
    }
    return { attempted: pending.length, delivered, failed };
  }

  /**
   * Poll the relay for envelopes addressed to my blinded id today,
   * decrypt each one, apply the CRDT op, mark it seen. Duplicates
   * (sync_seen hit) are skipped without advancing the ratchet a second
   * time. After a successful apply we DELETE the relay row so the
   * 30-day TTL sweep has less to do.
   */
  async pull(): Promise<PullResult> {
    // Poll today's blinded inbox plus the last `pullLookbackDays` UTC days.
    // The inbox id is bucketed per UTC day, so an envelope addressed just
    // before a UTC-midnight rollover — or while we were offline across one —
    // sits in a day bucket today's id would never match. Without the
    // look-back it stays stranded (no error, just never delivered) until its
    // 30-day relay TTL evicts it.
    const baseMs = this.now().getTime();
    let applied = 0;
    let duplicates = 0;
    let fetched = 0;
    const inboxes: string[] = [];
    for (let dayOffset = 0; dayOffset <= this.pullLookbackDays; dayOffset++) {
      const blindedId = await computeBlindedRecipientIdHex({
        connectionRoot: this.deps.connectionRoot,
        recipientPubkey: this.deps.selfPub,
        date: new Date(baseMs - dayOffset * 86_400_000),
      });
      inboxes.push(blindedId.slice(0, 8));
      let cursor: string | undefined;
      for (;;) {
        const page = await this.deps.api.listEnvelopes(blindedId, {
          since: cursor,
          limit: this.pollLimit,
        });
        fetched += page.items.length;
        for (const env of page.items) {
          const headerBytes = await base64ToBytes(env.header);
          const ciphertextBytes = await base64ToBytes(env.ciphertext);
          const hash = await envelopeHash(headerBytes, ciphertextBytes);
          if (await isEnvelopeSeen(this.deps.exec, hash)) {
            duplicates += 1;
            // The relay row is now redundant — drop it server-side to
            // keep the inbox tidy. Failures are swallowed: if the DELETE
            // doesn't go through, the TTL sweep cleans up anyway.
            try {
              await this.deps.api.deleteEnvelope(blindedId, env.id);
            } catch {
              // best effort
            }
            continue;
          }
          try {
            await this.decryptAndApply(headerBytes, ciphertextBytes, hash);
            applied += 1;
            try {
              await this.deps.api.deleteEnvelope(blindedId, env.id);
            } catch {
              // best effort — same logic as above.
            }
          } catch (e) {
            // A ratchet failure (gap-too-big, AEAD mismatch) or a projector
            // rejection (author-identity mismatch, etc.) leaves the envelope
            // on the relay for now. The next pull will see it again; the TTL
            // eventually evicts it. We do NOT markSeen — that would silently
            // lose data. Logged (was previously swallowed) because a
            // persistent failure here is invisible otherwise: the note is
            // fetched and decrypted but never lands on the receiver.
            console.warn('[sync] envelope apply failed (left on relay):', (e as Error).message);
          }
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
    }
    if (fetched > 0 || applied > 0) {
      console.log(
        `[sync] pull self=${inboxes[0]} buckets=[${inboxes.join(',')}] ` +
          `fetched=${fetched} applied=${applied} dup=${duplicates}`,
      );
    }
    return { fetched, applied, duplicates };
  }

  // --- private helpers ---

  private async encryptAndSend(op: CrdtOp): Promise<void> {
    const persisted = await loadRatchet(this.deps.exec, this.deps.connectionId);
    if (!persisted) throw new Error(`no ratchet for connection ${this.deps.connectionId}`);
    const { state } = persisted;
    const envBytes = serialiseOp(op);
    const env = await ratchetEncrypt(state, envBytes);
    await saveRatchet(this.deps.exec, this.deps.connectionId, state);

    const blindedId = await computeBlindedRecipientIdHex({
      connectionRoot: this.deps.connectionRoot,
      recipientPubkey: this.deps.peerPub,
      date: this.now(),
    });
    await this.deps.api.postEnvelope(blindedId, {
      v: 1,
      recipientBlindedId: blindedId,
      header: await bytesToBase64(env.header),
      ciphertext: await bytesToBase64(env.ciphertext),
      sentAt: this.now().toISOString(),
    });
    console.log(`[sync] sent op=${op.kind} → inbox=${blindedId.slice(0, 8)}`);
  }

  private async decryptAndApply(
    header: Uint8Array,
    ciphertext: Uint8Array,
    hash: Uint8Array,
  ): Promise<void> {
    const persisted = await loadRatchet(this.deps.exec, this.deps.connectionId);
    if (!persisted) throw new Error(`no ratchet for connection ${this.deps.connectionId}`);
    const { state } = persisted;
    const plaintext = await ratchetDecrypt(state, header, ciphertext);
    const op = deserialiseOp(plaintext);
    // Single transaction: apply the op, mark the envelope seen, save
    // the bumped ratchet. If any step throws the runner rolls back —
    // we'd rather replay than half-apply.
    //
    // `peerPub` is passed as the sender identity: every op that
    // arrives on this ratchet half was encrypted by the peer, so any
    // author / setter field carried by the op MUST match. The
    // projector enforces this per kind and throws on mismatch.
    await this.deps.exec.transaction(async () => {
      await applyCrdtOp(this.deps.exec, op, this.deps.peerPub);
      await markEnvelopeSeen(this.deps.exec, hash);
      await saveRatchet(this.deps.exec, this.deps.connectionId, state);
    });
  }
}
