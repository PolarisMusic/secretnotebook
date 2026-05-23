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
import { SyncEngine } from '../src/features/couple-channel/sync-engine';
import { runSyncCycle } from '../src/features/couple-channel/ticker';
import { LEDGER_REASON, POINTS_LOOP_COMPLETED } from '../src/features/ledger/couple-points';
import { countLedgerEntriesFor, sumCouplePoints } from '../src/features/ledger/store';
import {
  markGratitudeStep,
  setRoleplayRating,
  startRoleplay,
} from '../src/features/roleplay/actions';
import { sweepCompletedLoops } from '../src/features/roleplay/loop-sweeper';
import { findRoleplaySession, isRoleplayLoopComplete } from '../src/features/roleplay/store';
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

async function startSessionFromA(a: {
  exec: ReturnType<typeof nodeExecutor>;
  engine: SyncEngine;
}): Promise<string> {
  const { sessionId } = await startRoleplay({
    exec: a.exec,
    engine: a.engine,
    // B is the enactor (recipient), A is the curator (rater).
    enactorPubkey: B_PUB,
    curatorPubkey: A_PUB,
    savedPostId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    gratitudePromptKey: 'thank-you-for-doing',
    gratitudePromptTitle: 'Thank you for doing the thing',
    gratitudePromptBody:
      "Pick one chore your partner does that you don't always thank them for. Thank them today.",
  });
  return sessionId;
}

describe('startRoleplay — inserts the session and enqueues the start op', () => {
  it('writes a row with enactor/curator/saved_post_id + gratitude prompt text', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    const row = await findRoleplaySession(a.exec, sessionId);
    expect(row).not.toBeNull();
    expect(bytesToHex(row!.enactorPubkey)).toBe(bytesToHex(B_PUB));
    expect(bytesToHex(row!.curatorPubkey)).toBe(bytesToHex(A_PUB));
    expect(row!.savedPostId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
    expect(row!.gratitudePromptKey).toBe('thank-you-for-doing');
    expect(row!.rating).toBeNull();
    expect(row!.gratitudeEnactorDoneAt).toBeNull();
    expect(row!.gratitudeCuratorDoneAt).toBeNull();
  });

  it('rejects wrong-size pubkeys', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await expect(
      startRoleplay({
        exec: a.exec,
        engine: a.engine,
        enactorPubkey: new Uint8Array(16),
        curatorPubkey: A_PUB,
        savedPostId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        gratitudePromptKey: 'thank-you-for-doing',
        gratitudePromptTitle: 'x'.repeat(10),
        gratitudePromptBody: 'y'.repeat(20),
      }),
    ).rejects.toThrow(/enactorPubkey/);
  });
});

describe('setRoleplayRating — only the curator can rate', () => {
  it('writes the rating when fired by the curator', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    await setRoleplayRating({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      actorPubkey: A_PUB,
      rating: 8,
    });
    const row = await findRoleplaySession(a.exec, sessionId);
    expect(row!.rating).toBe(8);
  });

  it('is a no-op when fired by the enactor (projector actor guard)', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    await setRoleplayRating({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      actorPubkey: B_PUB, // enactor, not curator
      rating: 5,
    });
    const row = await findRoleplaySession(a.exec, sessionId);
    expect(row!.rating).toBeNull();
  });

  it('rejects ratings outside 1..10 at the action boundary', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    await expect(
      setRoleplayRating({
        exec: a.exec,
        engine: a.engine,
        sessionId,
        actorPubkey: A_PUB,
        rating: 11,
      }),
    ).rejects.toThrow(/1\.\.10/);
    await expect(
      setRoleplayRating({
        exec: a.exec,
        engine: a.engine,
        sessionId,
        actorPubkey: A_PUB,
        rating: 0,
      }),
    ).rejects.toThrow(/1\.\.10/);
  });

  it('a second rating attempt is a no-op (rating IS NULL guard)', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    await setRoleplayRating({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      actorPubkey: A_PUB,
      rating: 8,
    });
    await setRoleplayRating({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      actorPubkey: A_PUB,
      rating: 3,
    });
    expect((await findRoleplaySession(a.exec, sessionId))!.rating).toBe(8);
  });
});

describe('markGratitudeStep — completing the loop awards +25', () => {
  it('when the SECOND tap happens locally and both done, fires +25 with loopAwarded=true', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);

    const first = await markGratitudeStep({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      side: 'curator',
      actorPubkey: A_PUB,
    });
    expect(first.loopAwarded).toBe(false);
    expect(await sumCouplePoints(a.exec)).toBe(0);

    const second = await markGratitudeStep({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      side: 'enactor',
      actorPubkey: B_PUB,
    });
    expect(second.loopAwarded).toBe(true);
    expect(await sumCouplePoints(a.exec)).toBe(POINTS_LOOP_COMPLETED);
    expect(await countLedgerEntriesFor(a.exec, LEDGER_REASON.loopCompleted, sessionId)).toBe(1);
  });

  it('a redundant gratitude tap (same side, twice) does not double-award', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    await markGratitudeStep({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      side: 'curator',
      actorPubkey: A_PUB,
    });
    await markGratitudeStep({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      side: 'enactor',
      actorPubkey: B_PUB,
    });
    // Tap curator again — projector NULL-guard makes the update a
    // no-op; the loop-completed entry already exists; +25 stays 25.
    await markGratitudeStep({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      side: 'curator',
      actorPubkey: A_PUB,
    });
    expect(await sumCouplePoints(a.exec)).toBe(POINTS_LOOP_COMPLETED);
    expect(await countLedgerEntriesFor(a.exec, LEDGER_REASON.loopCompleted, sessionId)).toBe(1);
  });
});

describe('end-to-end loop — A starts, B rates skipped, both gratitude, both see +25', () => {
  it('full loop completion adds the same point totals on both devices (S8 acceptance)', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
    const sessionId = await startSessionFromA(a);
    await a.engine.flush();
    await b.engine.pull();

    // A (curator) submits a rating; B will eventually see it.
    await setRoleplayRating({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      actorPubkey: A_PUB,
      rating: 9,
    });
    await a.engine.flush();
    await b.engine.pull();

    // Both sides mark their gratitude step from their own device.
    await markGratitudeStep({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      side: 'curator',
      actorPubkey: A_PUB,
    });
    await markGratitudeStep({
      exec: b.exec,
      engine: b.engine,
      sessionId,
      side: 'enactor',
      actorPubkey: B_PUB,
    });
    // Each side has only its own step done locally — markGratitudeStep
    // didn't fire +25 yet.
    expect(await sumCouplePoints(a.exec)).toBe(0);
    expect(await sumCouplePoints(b.exec)).toBe(0);

    // Sync. After pulling each other's op, the sweeper closes the loop.
    await a.engine.flush();
    await b.engine.flush();
    const cycleA = await runSyncCycle(a.engine);
    const cycleB = await runSyncCycle(b.engine);

    // Each side awarded +25 from their own sweeper. The deterministic
    // ledger id collapses both attempts when they cross — both end up
    // with exactly one +25 entry.
    expect(cycleA.awardedSessionIds).toContain(sessionId);
    expect(cycleB.awardedSessionIds).toContain(sessionId);
    // Run another sync; sweeper now finds the loop already credited
    // (existence check on the ledger row) and doesn't re-award.
    await a.engine.flush();
    await b.engine.flush();
    await runSyncCycle(a.engine);
    await runSyncCycle(b.engine);

    expect(await sumCouplePoints(a.exec)).toBe(POINTS_LOOP_COMPLETED);
    expect(await sumCouplePoints(b.exec)).toBe(POINTS_LOOP_COMPLETED);
    expect(await countLedgerEntriesFor(a.exec, LEDGER_REASON.loopCompleted, sessionId)).toBe(1);
    expect(await countLedgerEntriesFor(b.exec, LEDGER_REASON.loopCompleted, sessionId)).toBe(1);

    // The rating made it across too — both sides see 9.
    expect((await findRoleplaySession(a.exec, sessionId))!.rating).toBe(9);
    expect((await findRoleplaySession(b.exec, sessionId))!.rating).toBe(9);
  });
});

describe('rating-never-on-API invariant', () => {
  it("the rating's plaintext does not appear in any relay envelope (ratchet ciphertext only)", async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    await setRoleplayRating({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      actorPubkey: A_PUB,
      rating: 7,
    });
    await a.engine.flush();
    for (const env of relay.rows) {
      // The wire payload is base64 ratchet ciphertext + header. The
      // plaintext rating ("7") is wrapped in a JSON op
      // {"rating":7,...}; that exact byte sequence must not appear
      // in either base64 field.
      expect(env.envelope.ciphertext).not.toContain('rating');
      expect(env.envelope.ciphertext).not.toContain('"7"');
      expect(env.envelope.header).not.toContain('rating');
    }
  });
});

describe('sweepCompletedLoops — sweeper invariants', () => {
  it('awards +25 for a session whose loop is closed but uncredited', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    // Directly stamp both done_at columns to simulate a converged
    // post-sync state without invoking the action layer's own +25.
    await a.exec.execute(
      `UPDATE roleplay_session
          SET gratitude_enactor_done_at = ?, gratitude_curator_done_at = ?
        WHERE id = ?`,
      [1, 1, sessionId],
    );
    const row = await findRoleplaySession(a.exec, sessionId);
    expect(isRoleplayLoopComplete(row!)).toBe(true);

    const result = await sweepCompletedLoops(a.exec, a.engine);
    expect(result.awardedSessionIds).toEqual([sessionId]);
    expect(await sumCouplePoints(a.exec)).toBe(POINTS_LOOP_COMPLETED);
  });

  it('skips sessions that already have their +25 ledger row', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    await a.exec.execute(
      `UPDATE roleplay_session
          SET gratitude_enactor_done_at = ?, gratitude_curator_done_at = ?
        WHERE id = ?`,
      [1, 1, sessionId],
    );
    await sweepCompletedLoops(a.exec, a.engine);
    const second = await sweepCompletedLoops(a.exec, a.engine);
    expect(second.awardedSessionIds).toEqual([]);
    expect(await sumCouplePoints(a.exec)).toBe(POINTS_LOOP_COMPLETED);
  });

  it("ignores sessions whose loop hasn't closed yet", async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const sessionId = await startSessionFromA(a);
    // Only one side done.
    await a.exec.execute(
      `UPDATE roleplay_session
          SET gratitude_enactor_done_at = ?
        WHERE id = ?`,
      [1, sessionId],
    );
    const result = await sweepCompletedLoops(a.exec, a.engine);
    expect(result.awardedSessionIds).toEqual([]);
    expect(await sumCouplePoints(a.exec)).toBe(0);
  });
});
