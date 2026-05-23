import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import type {
  RelayDeleteResponse,
  RelayPostResponse,
  SyncEnvelope,
  SyncEnvelopeList,
} from '@secretnotebook/shared-types';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { ApiClient } from '../src/features/api/client';
import { initAndSaveRatchet } from '../src/features/couple-channel/ratchet-store';
import { saveForPartner } from '../src/features/couple-channel/save-for-partner';
import {
  listSavedByMe,
  listSavedForMe,
  summariseSavedForMe,
} from '../src/features/couple-channel/saved-post-store';
import { SyncEngine } from '../src/features/couple-channel/sync-engine';
import { nodeExecutor } from './helpers/sqlite-executor';

const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');
const ROOT_KEY = new Uint8Array(32).fill(0xab);
const COUPLE_ID = '11111111-1111-1111-1111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);

interface Stored {
  id: string;
  blindedId: string;
  envelope: SyncEnvelope;
}

class FakeRelay {
  private readonly rows: Stored[] = [];
  private seq = 0;

  apiFor(): Pick<ApiClient, 'postEnvelope' | 'listEnvelopes' | 'deleteEnvelope'> {
    return {
      postEnvelope: async (
        blindedId: string,
        envelope: SyncEnvelope,
      ): Promise<RelayPostResponse> => {
        this.seq += 1;
        const id = `00000000-0000-0000-0000-${String(this.seq).padStart(12, '0')}`;
        this.rows.push({ id, blindedId, envelope });
        return {
          id,
          receivedAt: FIXED_NOW.toISOString(),
          expiresAt: new Date(FIXED_NOW.getTime() + 30 * 86_400_000).toISOString(),
        };
      },
      listEnvelopes: async (blindedId: string): Promise<SyncEnvelopeList> => ({
        items: this.rows
          .filter((r) => r.blindedId === blindedId)
          .map((r) => ({
            ...r.envelope,
            id: r.id,
            receivedAt: FIXED_NOW.toISOString(),
          })),
        nextCursor: null,
      }),
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
}

async function freshSide(args: {
  relay: FakeRelay;
  selfPub: Uint8Array;
  peerPub: Uint8Array;
}): Promise<{ exec: ReturnType<typeof nodeExecutor>; engine: SyncEngine }> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  await exec.execute(
    `INSERT INTO couple (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [COUPLE_ID, A_PUB, B_PUB, ROOT_KEY, 1_700_000_000, 'paired'],
  );
  await initAndSaveRatchet(exec, {
    coupleId: COUPLE_ID,
    rootKey: ROOT_KEY,
    selfPub: args.selfPub,
    peerPub: args.peerPub,
  });
  const engine = new SyncEngine({
    exec,
    api: args.relay.apiFor() as unknown as ApiClient,
    coupleId: COUPLE_ID,
    coupleRoot: ROOT_KEY,
    selfPub: args.selfPub,
    peerPub: args.peerPub,
    side: bytesToHex(args.selfPub) < bytesToHex(args.peerPub) ? 'a' : 'b',
    now: () => FIXED_NOW,
  });
  return { exec, engine };
}

describe('saveForPartner — local row written immediately', () => {
  it('inserts into saved_post on the calling device with savedBy = me', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: '33333333-3333-3333-3333-333333333333',
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
      now: () => 1_700_000_000,
    });
    const mine = await listSavedByMe(a.exec, A_PUB);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.globalPostId).toBe('33333333-3333-3333-3333-333333333333');
    expect(bytesToHex(mine[0]!.savedByPubkey)).toBe(bytesToHex(A_PUB));
    expect(bytesToHex(mine[0]!.savedForPubkey)).toBe(bytesToHex(B_PUB));
    expect(mine[0]!.unlockedAt).toBeNull();
  });

  it('rejects wrong-size pubkeys before doing anything', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await expect(
      saveForPartner({
        exec: a.exec,
        engine: a.engine,
        globalPostId: '33333333-3333-3333-3333-333333333333',
        savedByPubkey: new Uint8Array(16),
        savedForPubkey: B_PUB,
      }),
    ).rejects.toThrow(/savedByPubkey/);
    expect(await listSavedByMe(a.exec, A_PUB)).toHaveLength(0);
  });
});

describe('saveForPartner — end-to-end A → B', () => {
  it('partner sees the locked saved_post after one flush+pull cycle', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
    await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: '33333333-3333-3333-3333-333333333333',
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
      now: () => 1_700_000_000,
    });

    // A's own row is already there.
    expect(await listSavedByMe(a.exec, A_PUB)).toHaveLength(1);

    // Pre-sync: B sees nothing under their `saved_for_pubkey`.
    expect(await listSavedForMe(b.exec, B_PUB)).toHaveLength(0);

    await a.engine.flush();
    await b.engine.pull();

    // Acceptance: B's locked count is now 1 and the row is unlocked_at=NULL.
    const forB = await listSavedForMe(b.exec, B_PUB);
    expect(forB).toHaveLength(1);
    expect(forB[0]!.globalPostId).toBe('33333333-3333-3333-3333-333333333333');
    expect(forB[0]!.unlockedAt).toBeNull();
    expect(bytesToHex(forB[0]!.savedByPubkey)).toBe(bytesToHex(A_PUB));

    const summary = await summariseSavedForMe(b.exec, B_PUB);
    expect(summary).toEqual({ total: 1, locked: 1, unlocked: 0 });
  });

  it('idempotent on the sender — re-syncing their own envelope (e.g. clock-rotation) does not duplicate the row', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: '44444444-4444-4444-4444-444444444444',
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
    });
    await a.engine.flush();
    // The sender's row already exists locally — even if a future
    // backfill projector apply ever runs on the same device, the
    // INSERT OR IGNORE in the projector collapses the second insert.
    expect(await listSavedByMe(a.exec, A_PUB)).toHaveLength(1);
  });
});

describe('summariseSavedForMe — count helper', () => {
  it('reports total / locked / unlocked split correctly', async () => {
    const relay = new FakeRelay();
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
    // Seed three rows directly: two locked, one unlocked.
    await b.exec.execute(
      `INSERT INTO saved_post (id, global_post_id, saved_by_pubkey, saved_for_pubkey, created_at, unlocked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      ['a', 'g1', A_PUB, B_PUB, 1],
    );
    await b.exec.execute(
      `INSERT INTO saved_post (id, global_post_id, saved_by_pubkey, saved_for_pubkey, created_at, unlocked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      ['b', 'g2', A_PUB, B_PUB, 2],
    );
    await b.exec.execute(
      `INSERT INTO saved_post (id, global_post_id, saved_by_pubkey, saved_for_pubkey, created_at, unlocked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['c', 'g3', A_PUB, B_PUB, 3, 4],
    );

    expect(await summariseSavedForMe(b.exec, B_PUB)).toEqual({
      total: 3,
      locked: 2,
      unlocked: 1,
    });
  });

  it('returns zeros when no rows are saved for me', async () => {
    const relay = new FakeRelay();
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
    expect(await summariseSavedForMe(b.exec, B_PUB)).toEqual({
      total: 0,
      locked: 0,
      unlocked: 0,
    });
  });
});
