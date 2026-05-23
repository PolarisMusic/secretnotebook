import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import type {
  ReceivedSyncEnvelope,
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
import { SyncEngine } from '../src/features/couple-channel/sync-engine';
import {
  awardCouplePoints,
  deriveLedgerEntryId,
  LEDGER_REASON,
  POINTS_PROMPT_CERTIFIED,
  POINTS_SAVE_FOR_PARTNER,
} from '../src/features/ledger/couple-points';
import {
  countLedgerEntriesFor,
  listRecentLedgerEntries,
  sumCouplePoints,
} from '../src/features/ledger/store';
import { nodeExecutor } from './helpers/sqlite-executor';

const ROOT_KEY = new Uint8Array(32).fill(0xab);
const COUPLE_ID = '11111111-1111-1111-1111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);
const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');

interface Stored {
  id: string;
  blindedId: string;
  envelope: SyncEnvelope;
}

class FakeRelay {
  rows: Stored[] = [];
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
      listEnvelopes: async (blindedId: string): Promise<SyncEnvelopeList> => {
        const items: ReceivedSyncEnvelope[] = this.rows
          .filter((r) => r.blindedId === blindedId)
          .map((r) => ({
            ...r.envelope,
            id: r.id,
            receivedAt: FIXED_NOW.toISOString(),
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

describe('deriveLedgerEntryId — deterministic dedup keys', () => {
  it('emits the same UUID for the same (reason, refId)', async () => {
    const a = await deriveLedgerEntryId('save-for-partner', '11111111-1111-1111-1111-111111111111');
    const b = await deriveLedgerEntryId('save-for-partner', '11111111-1111-1111-1111-111111111111');
    expect(a).toBe(b);
  });

  it('produces a different UUID when the reason changes', async () => {
    const a = await deriveLedgerEntryId('save-for-partner', '11111111-1111-1111-1111-111111111111');
    const b = await deriveLedgerEntryId('prompt-certified', '11111111-1111-1111-1111-111111111111');
    expect(a).not.toBe(b);
  });

  it('produces a different UUID when the refId changes', async () => {
    const a = await deriveLedgerEntryId('save-for-partner', '11111111-1111-1111-1111-111111111111');
    const b = await deriveLedgerEntryId('save-for-partner', '22222222-2222-2222-2222-222222222222');
    expect(a).not.toBe(b);
  });

  it('emits a UUID string that passes the standard 8-4-4-4-12 hex layout', async () => {
    const id = await deriveLedgerEntryId('x', 'y');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('awardCouplePoints — local write + enqueue + idempotency', () => {
  it('writes the ledger row locally and enqueues the op', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const op = await awardCouplePoints({
      exec: a.exec,
      engine: a.engine,
      delta: 7,
      reason: 'unit-test',
      refId: '33333333-3333-3333-3333-333333333333',
      now: () => 1_700_000_500,
    });
    expect(op.delta).toBe(7);
    expect(op.reason).toBe('unit-test');

    const entries = await listRecentLedgerEntries(a.exec);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.delta).toBe(7);
    expect(entries[0]!.refId).toBe('33333333-3333-3333-3333-333333333333');
    expect(await sumCouplePoints(a.exec)).toBe(7);
  });

  it('a second award with the same (reason, refId) is a no-op locally', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await awardCouplePoints({
      exec: a.exec,
      engine: a.engine,
      delta: 7,
      reason: 'unit-test',
      refId: '33333333-3333-3333-3333-333333333333',
    });
    await awardCouplePoints({
      exec: a.exec,
      engine: a.engine,
      delta: 7,
      reason: 'unit-test',
      refId: '33333333-3333-3333-3333-333333333333',
    });
    expect(await sumCouplePoints(a.exec)).toBe(7);
    expect(
      await countLedgerEntriesFor(a.exec, 'unit-test', '33333333-3333-3333-3333-333333333333'),
    ).toBe(1);
  });

  it('rejects non-integer delta', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await expect(
      awardCouplePoints({
        exec: a.exec,
        engine: a.engine,
        delta: 1.5,
        reason: 'unit-test',
        refId: '33333333-3333-3333-3333-333333333333',
      }),
    ).rejects.toThrow(/integer/);
  });

  it('rejects empty + oversized reasons', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await expect(
      awardCouplePoints({
        exec: a.exec,
        engine: a.engine,
        delta: 1,
        reason: '',
        refId: '33333333-3333-3333-3333-333333333333',
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      awardCouplePoints({
        exec: a.exec,
        engine: a.engine,
        delta: 1,
        reason: 'x'.repeat(121),
        refId: '33333333-3333-3333-3333-333333333333',
      }),
    ).rejects.toThrow(/reason/);
  });
});

describe('saveForPartner — fires +2 alongside the saved_post.add op', () => {
  it('a single save yields +2 in the ledger, tied to the savedPost.id', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const result = await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
    });
    expect(await sumCouplePoints(a.exec)).toBe(POINTS_SAVE_FOR_PARTNER);
    expect(
      await countLedgerEntriesFor(a.exec, LEDGER_REASON.saveForPartner, result.savedPostId),
    ).toBe(1);
  });

  it('three distinct saves yield three +2 entries (+6 total)', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    for (const id of [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    ]) {
      await saveForPartner({
        exec: a.exec,
        engine: a.engine,
        globalPostId: id,
        savedByPubkey: A_PUB,
        savedForPubkey: B_PUB,
      });
    }
    expect(await sumCouplePoints(a.exec)).toBe(3 * POINTS_SAVE_FOR_PARTNER);
  });

  it("the partner's pulled saved_post.add mirrors the +2 onto the partner's ledger too", async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
    });
    await a.engine.flush();
    await b.engine.pull();

    // Both sides converge to +2.
    expect(await sumCouplePoints(a.exec)).toBe(POINTS_SAVE_FOR_PARTNER);
    expect(await sumCouplePoints(b.exec)).toBe(POINTS_SAVE_FOR_PARTNER);
  });
});

describe('cross-device convergence — same point totals after sync', () => {
  it('A saves twice + earns a manual +10 → both sides see +14 after pull', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
    });
    await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
    });
    await awardCouplePoints({
      exec: a.exec,
      engine: a.engine,
      delta: POINTS_PROMPT_CERTIFIED,
      reason: LEDGER_REASON.promptCertified,
      refId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    });
    await a.engine.flush();
    await b.engine.pull();

    const expected = 2 * POINTS_SAVE_FOR_PARTNER + POINTS_PROMPT_CERTIFIED;
    expect(await sumCouplePoints(a.exec)).toBe(expected);
    expect(await sumCouplePoints(b.exec)).toBe(expected);
  });

  it('idempotent merge — if B re-pulls the same envelopes nothing double-counts', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
    });
    await a.engine.flush();
    await b.engine.pull();
    await b.engine.pull(); // replay
    await b.engine.pull(); // replay
    expect(await sumCouplePoints(b.exec)).toBe(POINTS_SAVE_FOR_PARTNER);
  });
});

describe('listRecentLedgerEntries', () => {
  it('returns newest-first by (created_at DESC, ROWID DESC)', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await awardCouplePoints({
      exec: a.exec,
      engine: a.engine,
      delta: 1,
      reason: 'first',
      refId: '11111111-1111-1111-1111-111111111111',
      now: () => 100,
    });
    await awardCouplePoints({
      exec: a.exec,
      engine: a.engine,
      delta: 2,
      reason: 'second',
      refId: '22222222-2222-2222-2222-222222222222',
      now: () => 200,
    });
    const entries = await listRecentLedgerEntries(a.exec);
    expect(entries.map((e) => e.reason)).toEqual(['second', 'first']);
  });

  it('respects the limit', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    for (let i = 0; i < 5; i++) {
      await awardCouplePoints({
        exec: a.exec,
        engine: a.engine,
        delta: 1,
        reason: `r-${i}`,
        refId: `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`,
        now: () => 100 + i,
      });
    }
    expect((await listRecentLedgerEntries(a.exec, 2)).length).toBe(2);
    expect(await listRecentLedgerEntries(a.exec, 0)).toEqual([]);
  });
});
