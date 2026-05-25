import { describe, expect, it } from '@jest/globals';
import {
  computeBlindedRecipientIdHex,
  type CrdtOp,
  type SavedPostAddOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';
import type {
  RelayDeleteResponse,
  RelayPostResponse,
  SyncEnvelope,
  SyncEnvelopeList,
  ReceivedSyncEnvelope,
} from '@secretnotebook/shared-types';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { ApiClient } from '../src/features/api/client';
import { initAndSaveRatchet } from '../src/features/connection-channel/ratchet-store';
import { SyncEngine } from '../src/features/connection-channel/sync-engine';
import { nodeExecutor } from './helpers/sqlite-executor';

// --- shared fixtures ---------------------------------------------------------

const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');
const ROOT_KEY = new Uint8Array(32).fill(0xab);
const CONNECTION_ID = '11111111-1111-1111-1111-111111111111';
// A's pubkey sorts lex-lower than B's → A is side 'a'.
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);

interface StoredEnvelope {
  id: string;
  blindedId: string;
  v: 1;
  recipientBlindedId: string;
  header: string;
  ciphertext: string;
  sentAt: string;
  receivedAt: string;
}

/**
 * In-process fake relay. The real server stores envelopes addressed to
 * a blinded id and lets either party POST / GET / DELETE. We mirror just
 * enough of that surface for the sync engine to talk to.
 */
class FakeRelay {
  private readonly rows: StoredEnvelope[] = [];
  private seq = 0;

  apiFor(): Pick<ApiClient, 'postEnvelope' | 'listEnvelopes' | 'deleteEnvelope'> {
    return {
      postEnvelope: async (
        blindedId: string,
        envelope: SyncEnvelope,
      ): Promise<RelayPostResponse> => {
        this.seq += 1;
        const id = `00000000-0000-0000-0000-${String(this.seq).padStart(12, '0')}`;
        const receivedAt = FIXED_NOW.toISOString();
        const expiresAt = new Date(FIXED_NOW.getTime() + 30 * 86_400_000).toISOString();
        this.rows.push({
          id,
          blindedId,
          v: 1,
          recipientBlindedId: envelope.recipientBlindedId,
          header: envelope.header,
          ciphertext: envelope.ciphertext,
          sentAt: envelope.sentAt,
          receivedAt,
        });
        return { id, receivedAt, expiresAt };
      },
      listEnvelopes: async (blindedId: string): Promise<SyncEnvelopeList> => {
        const items: ReceivedSyncEnvelope[] = this.rows
          .filter((r) => r.blindedId === blindedId)
          .map((r) => ({
            v: 1,
            id: r.id,
            recipientBlindedId: r.recipientBlindedId,
            header: r.header,
            ciphertext: r.ciphertext,
            sentAt: r.sentAt,
            receivedAt: r.receivedAt,
          }));
        return { items, nextCursor: null };
      },
      deleteEnvelope: async (
        blindedId: string,
        envelopeId: string,
      ): Promise<RelayDeleteResponse> => {
        const idx = this.rows.findIndex((r) => r.blindedId === blindedId && r.id === envelopeId);
        if (idx !== -1) this.rows.splice(idx, 1);
        return { ok: true as const };
      },
    };
  }

  /** For "server cannot decrypt" assertion. */
  rawCiphertexts(): string[] {
    return this.rows.map((r) => r.ciphertext);
  }

  size(): number {
    return this.rows.length;
  }

  /** Stash an envelope into a different blinded inbox (used to test
   *  privacy: A's envelopes for B don't show up under A's blinded id). */
  rowsForBlindedId(blindedId: string): StoredEnvelope[] {
    return this.rows.filter((r) => r.blindedId === blindedId);
  }
}

interface Side {
  exec: ReturnType<typeof nodeExecutor>;
  engine: SyncEngine;
  selfPub: Uint8Array;
  peerPub: Uint8Array;
}

async function freshDb(): Promise<ReturnType<typeof nodeExecutor>> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  // Connection row keyed on the canonical id so the ratchet FK is satisfied.
  await exec.execute(
    `INSERT INTO connection (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [CONNECTION_ID, A_PUB, B_PUB, ROOT_KEY, 1_700_000_000, 'paired'],
  );
  return exec;
}

async function makeSide(args: {
  selfPub: Uint8Array;
  peerPub: Uint8Array;
  relay: FakeRelay;
}): Promise<Side> {
  const exec = await freshDb();
  await initAndSaveRatchet(
    exec,
    {
      connectionId: CONNECTION_ID,
      rootKey: ROOT_KEY,
      selfPub: args.selfPub,
      peerPub: args.peerPub,
    },
    () => FIXED_NOW.getTime(),
  );
  const engine = new SyncEngine({
    exec,
    api: args.relay.apiFor() as unknown as ApiClient,
    connectionId: CONNECTION_ID,
    connectionRoot: ROOT_KEY,
    selfPub: args.selfPub,
    peerPub: args.peerPub,
    now: () => FIXED_NOW,
  });
  return { exec, engine, selfPub: args.selfPub, peerPub: args.peerPub };
}

async function pair(relay: FakeRelay): Promise<{ a: Side; b: Side }> {
  return {
    a: await makeSide({ selfPub: A_PUB, peerPub: B_PUB, relay }),
    b: await makeSide({ selfPub: B_PUB, peerPub: A_PUB, relay }),
  };
}

function savedPostOp(overrides: Partial<SavedPostAddOp> = {}): SavedPostAddOp {
  return {
    v: 1,
    kind: 'saved_post.add',
    id: '22222222-2222-2222-2222-222222222222',
    globalPostId: '33333333-3333-3333-3333-333333333333',
    savedByPubkey: bytesToHex(A_PUB),
    savedForPubkey: bytesToHex(B_PUB),
    createdAt: 1_700_000_000,
    ...overrides,
  };
}

interface SavedPostRow {
  id: string;
  global_post_id: string;
  saved_by_pubkey: Uint8Array;
  saved_for_pubkey: Uint8Array;
}

async function selectSavedPosts(exec: ReturnType<typeof nodeExecutor>): Promise<SavedPostRow[]> {
  return exec.query<SavedPostRow>(
    'SELECT id, global_post_id, saved_by_pubkey, saved_for_pubkey FROM saved_post ORDER BY id ASC',
  );
}

// --- tests -------------------------------------------------------------------

describe('SyncEngine — single op end-to-end (acceptance: A writes → B sees)', () => {
  it('delivers a saved_post.add from A to B in one flush+pull cycle', async () => {
    const relay = new FakeRelay();
    const { a, b } = await pair(relay);
    const op = savedPostOp({ id: '22222222-2222-2222-2222-222222222222' });

    await a.engine.enqueue(op);
    const flush = await a.engine.flush();
    expect(flush).toEqual({ attempted: 1, delivered: 1, failed: 0 });
    expect(relay.size()).toBe(1);

    // Pre-pull: B's saved_post is empty.
    expect(await selectSavedPosts(b.exec)).toEqual([]);

    const pull = await b.engine.pull();
    expect(pull).toEqual({ fetched: 1, applied: 1, duplicates: 0 });

    const rows = await selectSavedPosts(b.exec);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(op.id);
    expect(rows[0]!.global_post_id).toBe(op.globalPostId);
    // Successful pull DELETEs the relay row.
    expect(relay.size()).toBe(0);
  });
});

describe('SyncEngine — multiple ops in order', () => {
  it('delivers a burst of three saved_post.add ops, applied once each on B', async () => {
    const relay = new FakeRelay();
    const { a, b } = await pair(relay);
    const ids = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
    ];
    for (const id of ids) await a.engine.enqueue(savedPostOp({ id }));
    await a.engine.flush();
    expect(relay.size()).toBe(3);

    const pull = await b.engine.pull();
    expect(pull.applied).toBe(3);
    const rows = await selectSavedPosts(b.exec);
    expect(rows.map((r) => r.id).sort()).toEqual(ids);
  });
});

describe('SyncEngine — idempotency and replay', () => {
  it('a second pull is a no-op (apply count is 0, duplicates already cleaned up)', async () => {
    const relay = new FakeRelay();
    const { a, b } = await pair(relay);
    await a.engine.enqueue(savedPostOp({ id: '44444444-4444-4444-4444-444444444444' }));
    await a.engine.flush();
    await b.engine.pull();
    const second = await b.engine.pull();
    expect(second).toEqual({ fetched: 0, applied: 0, duplicates: 0 });
  });

  it("re-injecting the same envelope (deleted-then-replayed) doesn't double-apply", async () => {
    const relay = new FakeRelay();
    const { a, b } = await pair(relay);
    const op = savedPostOp({ id: '55555555-5555-5555-5555-555555555555' });
    await a.engine.enqueue(op);
    await a.engine.flush();

    // Snapshot the on-wire envelope so we can replay it byte-for-byte.
    const blindedB = await computeBlindedRecipientIdHex({
      connectionRoot: ROOT_KEY,
      recipientPubkey: B_PUB,
      date: FIXED_NOW,
    });
    const stashed = relay.rowsForBlindedId(blindedB)[0]!;

    await b.engine.pull(); // legitimately applies + DELETE
    expect((await selectSavedPosts(b.exec)).length).toBe(1);

    // Re-inject the same bytes as if a malicious or laggy node replayed them.
    relay.apiFor().postEnvelope(blindedB, {
      v: 1,
      recipientBlindedId: blindedB,
      header: stashed.header,
      ciphertext: stashed.ciphertext,
      sentAt: stashed.sentAt,
    });

    const replay = await b.engine.pull();
    expect(replay.applied).toBe(0);
    expect(replay.duplicates).toBe(1);
    expect((await selectSavedPosts(b.exec)).length).toBe(1);
  });
});

describe('SyncEngine — out-of-order delivery', () => {
  it('converges even when envelopes are returned in reverse order', async () => {
    const relay = new FakeRelay();
    const { a, b } = await pair(relay);
    const ids = [
      'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000003',
    ];
    for (const id of ids) await a.engine.enqueue(savedPostOp({ id }));
    await a.engine.flush();

    // Reverse-deliver: hijack the listEnvelopes call once to flip the
    // order so B sees counter 2 first, then 1, then 0. The ratchet's
    // skipped-key cache must keep them all decryptable.
    const blindedB = await computeBlindedRecipientIdHex({
      connectionRoot: ROOT_KEY,
      recipientPubkey: B_PUB,
      date: FIXED_NOW,
    });
    const originalApi = relay.apiFor();
    const flippedApi: typeof originalApi = {
      ...originalApi,
      listEnvelopes: async (id) => {
        const page = await originalApi.listEnvelopes(id);
        return { items: page.items.slice().reverse(), nextCursor: page.nextCursor };
      },
    };
    void blindedB;

    const flippedEngine = new SyncEngine({
      exec: b.exec,
      api: flippedApi as unknown as ApiClient,
      connectionId: CONNECTION_ID,
      connectionRoot: ROOT_KEY,
      selfPub: B_PUB,
      peerPub: A_PUB,
      now: () => FIXED_NOW,
    });

    const pull = await flippedEngine.pull();
    expect(pull.applied).toBe(3);
    const rows = await selectSavedPosts(b.exec);
    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
  });
});

describe('SyncEngine — bidirectional', () => {
  it('A and B both write, both see — chains line up in both directions', async () => {
    const relay = new FakeRelay();
    const { a, b } = await pair(relay);
    const opFromA = savedPostOp({
      id: 'a000a000-a000-a000-a000-a00000000001',
      savedByPubkey: bytesToHex(A_PUB),
      savedForPubkey: bytesToHex(B_PUB),
    });
    const opFromB: SavedPostAddOp = {
      v: 1,
      kind: 'saved_post.add',
      id: 'b000b000-b000-b000-b000-b00000000001',
      globalPostId: '44444444-4444-4444-4444-444444444444',
      savedByPubkey: bytesToHex(B_PUB),
      savedForPubkey: bytesToHex(A_PUB),
      createdAt: 1_700_000_000,
    };

    await a.engine.enqueue(opFromA);
    await b.engine.enqueue(opFromB);
    await a.engine.flush();
    await b.engine.flush();
    await b.engine.pull();
    await a.engine.pull();

    const aRows = await selectSavedPosts(a.exec);
    const bRows = await selectSavedPosts(b.exec);
    // A's own enqueue did NOT touch A's saved_post (projection only
    // happens on the receiving side in this engine — sender writes
    // local state independently). Each side has exactly the op the
    // partner sent.
    expect(aRows.map((r) => r.id)).toEqual([opFromB.id]);
    expect(bRows.map((r) => r.id)).toEqual([opFromA.id]);
  });
});

describe('SyncEngine — server cannot decrypt', () => {
  it('the relay only ever sees opaque base64 bytes, never the op json', async () => {
    const relay = new FakeRelay();
    const { a } = await pair(relay);
    const op = savedPostOp({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      globalPostId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    });
    await a.engine.enqueue(op);
    await a.engine.flush();
    for (const c of relay.rawCiphertexts()) {
      expect(c).not.toContain(op.id);
      expect(c).not.toContain(op.globalPostId);
      expect(c).not.toContain('saved_post.add');
      // The ciphertext is base64 — try decoding and confirm there's no
      // ASCII JSON marker either.
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(
        Uint8Array.from(atob(c), (x) => x.charCodeAt(0)),
      );
      expect(raw).not.toContain('"kind"');
      expect(raw).not.toContain(op.id);
    }
  });
});

describe('SyncEngine — outbox retry on POST failure', () => {
  it('leaves the row in the outbox with bumped attempts when POST throws', async () => {
    const relay = new FakeRelay();
    const exec = await freshDb();
    await initAndSaveRatchet(
      exec,
      { connectionId: CONNECTION_ID, rootKey: ROOT_KEY, selfPub: A_PUB, peerPub: B_PUB },
      () => FIXED_NOW.getTime(),
    );
    const flakyApi = {
      ...relay.apiFor(),
      postEnvelope: async () => {
        throw new Error('network');
      },
    };
    const engine = new SyncEngine({
      exec,
      api: flakyApi as unknown as ApiClient,
      connectionId: CONNECTION_ID,
      connectionRoot: ROOT_KEY,
      selfPub: A_PUB,
      peerPub: B_PUB,
      now: () => FIXED_NOW,
      retryBackoffMs: 60_000,
    });
    await engine.enqueue(savedPostOp({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }));
    const result = await engine.flush();
    expect(result).toEqual({ attempted: 1, delivered: 0, failed: 1 });
    const remaining = await exec.query<{ id: string; attempts: number; next_attempt_at: number }>(
      'SELECT id, attempts, next_attempt_at FROM sync_outbox',
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.attempts).toBe(1);
    expect(remaining[0]!.next_attempt_at).toBeGreaterThan(Math.floor(FIXED_NOW.getTime() / 1000));
  });
});

describe('CrdtOp dispatch — retired ledger_entry.add (R6.2)', () => {
  it('swallows a stale ledger_entry.add as a projector no-op — relay envelope still gets delivered + deleted (no infinite retry)', async () => {
    // R0 retired the only writer of ledger_entry rows; R6.2 keeps
    // the schema in the union so a stale envelope from a pre-R6.2
    // client still parses (otherwise pull would loop on it until
    // TTL eviction) but the projector inserts NOTHING. We assert
    // both halves: no row inserted, AND the relay envelope is
    // gone after pull (proving the no-op path completed cleanly).
    const relay = new FakeRelay();
    const { a, b } = await pair(relay);
    const op: CrdtOp = {
      v: 1,
      kind: 'ledger_entry.add',
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ledgerKind: 'couple_points',
      delta: 25,
      reason: 'completed-loop',
      refId: null,
      createdAt: 1_700_000_000,
    };
    await a.engine.enqueue(op);
    await a.engine.flush();
    expect(relay.rows).toHaveLength(1);

    await b.engine.pull();
    const rows = await b.exec.query<{ id: string }>(`SELECT id FROM ledger_entry`);
    expect(rows).toEqual([]);
    expect(relay.rows).toHaveLength(0);
  });
});
