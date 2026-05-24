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
import { initAndSaveRatchet, loadRatchet } from '../src/features/couple-channel/ratchet-store';
import { listSavedByMe } from '../src/features/couple-channel/saved-post-store';
import { SyncEngine } from '../src/features/couple-channel/sync-engine';
import { sumCouplePoints } from '../src/features/ledger/store';
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

interface Side {
  exec: ReturnType<typeof nodeExecutor>;
  engine: SyncEngine;
}

async function freshSide(args: {
  relay: FakeRelay;
  selfPub: Uint8Array;
  peerPub: Uint8Array;
}): Promise<Side> {
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

async function syncBoth(a: Side, b: Side): Promise<void> {
  await a.engine.flush();
  await b.engine.flush();
  await a.engine.pull();
  await b.engine.pull();
}

/**
 * Phase-1.5 R0.5 acceptance harness — the minimal integration backbone
 * the rest of the refactor builds on. The pre-S9 harness drove the
 * full save → assign → certify → unlock → rate → gratitude → +37 loop;
 * everything past "two paired devices that can sync" was deleted in
 * R0 and gets layered back in by:
 *
 *   R2 — shared-note round-trip, secret-note announce + reveal,
 *        and the secret-body-never-on-wire invariant
 *   R3 — publish-from-note → server post → delete
 *   R5 — IAP-gated publish + receipt-validation harness
 *
 * The harness here just asserts the empty starting position: both
 * sides migrate, persist a couple row, init their ratchet, build a
 * SyncEngine, and report zero rows everywhere + zero envelopes on
 * the wire after a no-op sync cycle. If any future change to the
 * boot pipeline breaks this floor, CI catches it before R2 even
 * tries to write a note.
 */
describe('Phase-1.5 acceptance harness — empty-state floor', () => {
  it('two devices migrate, persist a paired couple + ratchet, and start clean', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    // Both ratchets land healthy with the correct side assignment
    // (lexicographic order on pubkey hex determines a/b).
    const aRatchet = await loadRatchet(a.exec, COUPLE_ID);
    const bRatchet = await loadRatchet(b.exec, COUPLE_ID);
    expect(aRatchet?.side).toBe('a');
    expect(bRatchet?.side).toBe('b');

    // Data tables empty on both sides.
    expect(await listSavedByMe(a.exec, A_PUB)).toEqual([]);
    expect(await listSavedByMe(b.exec, B_PUB)).toEqual([]);
    expect(await sumCouplePoints(a.exec)).toBe(0);
    expect(await sumCouplePoints(b.exec)).toBe(0);
  });

  it('a no-op sync cycle puts nothing on the wire and pulls nothing back', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await syncBoth(a, b);

    // Relay never saw an envelope (nothing to flush, no spurious posts).
    expect(relay.rows).toEqual([]);

    // Data tables are still empty (pull didn't materialise anything).
    expect(await listSavedByMe(a.exec, A_PUB)).toEqual([]);
    expect(await listSavedByMe(b.exec, B_PUB)).toEqual([]);
    expect(await sumCouplePoints(a.exec)).toBe(0);
    expect(await sumCouplePoints(b.exec)).toBe(0);

    // Second cycle is also a no-op — guards against an
    // accidental-keepalive regression where the engine pings the
    // relay on every cycle for no reason.
    await syncBoth(a, b);
    expect(relay.rows).toEqual([]);
  });
});
