import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import { GRATITUDE_LIBRARY, pickPromptWeighted } from '@secretnotebook/prompt-library';
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
import { findPromptById } from '../src/features/prompts/store';
import { listUnlockedForMe } from '../src/features/couple-channel/saved-post-store';
import { SyncEngine } from '../src/features/couple-channel/sync-engine';
import { runSyncCycle } from '../src/features/couple-channel/ticker';
import {
  LEDGER_REASON,
  POINTS_LOOP_COMPLETED,
  POINTS_PROMPT_CERTIFIED,
  POINTS_SAVE_FOR_PARTNER,
  awardCouplePoints,
} from '../src/features/ledger/couple-points';
import { sumCouplePoints } from '../src/features/ledger/store';
import { assignPromptForPartner } from '../src/features/prompts/assigner';
import { certifyPromptCompletion, markPromptCompleted } from '../src/features/prompts/transitions';
import {
  markGratitudeStep,
  setRoleplayRating,
  startRoleplay,
} from '../src/features/roleplay/actions';
import { findRoleplaySession } from '../src/features/roleplay/store';
import { unlockOneRandomFor } from '../src/features/saved-posts/random-unlocker';
import { nodeExecutor } from './helpers/sqlite-executor';

const ROOT_KEY = new Uint8Array(32).fill(0xab);
const COUPLE_ID = '11111111-1111-1111-1111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);
const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');

const GLOBAL_POST_ID = 'cafef00d-cafe-f00d-cafe-cafef00dcafe';

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
 * The pre-S9 in-process acceptance harness. Walks the full Phase-1
 * happy path through two SQLCipher-backed sides connected by a fake
 * relay, asserting that the end state matches the spec's acceptance
 * for every slice that has one. Anything that breaks the data plumbing
 * downstream of these assertions blows up CI, even if no Detox spec
 * has run yet.
 *
 * Walks: save (+2) → assign → complete → certify (+10 + unlock) →
 * "I tried it" → rate → both gratitude → +25 → final ledger.
 *
 * Acceptance per slice:
 *   - S5: locked count on B → 1 (then 0 unlocked) after sync.
 *   - S6: prompt cannot reach 'certified' without both sides' actions
 *         — the test only flips to certified after A's CertifyCompletion
 *         action runs; both sides converge to 'certified' after sync.
 *   - S7: exactly-one-unlock invariant — one row unlocked, unlocking
 *         prompt id linked. (Concurrent unlocks across two prompts
 *         already covered by random-unlocker.test.ts.)
 *   - S8: full loop completion adds the same point totals on both
 *         devices — 2+10+25 = 37 on each side.
 */
describe('Phase-1 happy path — in-process two-device acceptance', () => {
  it('walks save → assign → certify → unlock → try → rate → gratitude → +37', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    // Step 1 — A saves a global post for B.  (S5: +2 lands on A
    // immediately; on B after the next sync.)
    const { savedPostId } = await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: GLOBAL_POST_ID,
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
    });
    expect(await sumCouplePoints(a.exec)).toBe(POINTS_SAVE_FOR_PARTNER);
    await syncBoth(a, b);
    expect(await sumCouplePoints(b.exec)).toBe(POINTS_SAVE_FOR_PARTNER);

    // Step 2 — A assigns a prompt to B.
    const { promptId } = await assignPromptForPartner({
      exec: a.exec,
      engine: a.engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      random: () => 0,
    });
    await syncBoth(a, b);
    expect((await findPromptById(a.exec, promptId))!.state).toBe('assigned');
    expect((await findPromptById(b.exec, promptId))!.state).toBe('assigned');

    // Step 3 — B marks the prompt completed (assignee-only).
    await markPromptCompleted({
      exec: b.exec,
      engine: b.engine,
      promptId,
      actorPubkey: B_PUB,
      now: () => 1_700_000_500,
    });
    expect((await findPromptById(b.exec, promptId))!.state).toBe('completed');
    await syncBoth(a, b);
    // A sees completed too — but NOT yet certified (S6 acceptance).
    expect((await findPromptById(a.exec, promptId))!.state).toBe('completed');

    // Step 4 — A certifies + fires +10 + picks one of B's locked
    // saved_posts to unlock (S7).
    await certifyPromptCompletion({
      exec: a.exec,
      engine: a.engine,
      promptId,
      actorPubkey: A_PUB,
      now: () => 1_700_000_700,
    });
    const unlock = await unlockOneRandomFor({
      exec: a.exec,
      engine: a.engine,
      assigneePubkey: B_PUB,
      unlockPromptId: promptId,
      random: () => 0,
      now: () => 1_700_000_701,
    });
    expect(unlock).not.toBeNull();
    await awardCouplePoints({
      exec: a.exec,
      engine: a.engine,
      delta: POINTS_PROMPT_CERTIFIED,
      reason: LEDGER_REASON.promptCertified,
      refId: promptId,
    });
    await syncBoth(a, b);

    // Both sides see certified + the saved_post unlocked + +10 in the
    // ledger (so total now 2+10=12).
    expect((await findPromptById(a.exec, promptId))!.state).toBe('certified');
    expect((await findPromptById(b.exec, promptId))!.state).toBe('certified');
    const unlockedForB = await listUnlockedForMe(b.exec, B_PUB);
    expect(unlockedForB).toHaveLength(1);
    expect(unlockedForB[0]!.id).toBe(savedPostId);
    expect(unlockedForB[0]!.unlockPromptId).toBe(promptId);
    expect(await sumCouplePoints(a.exec)).toBe(POINTS_SAVE_FOR_PARTNER + POINTS_PROMPT_CERTIFIED);
    expect(await sumCouplePoints(b.exec)).toBe(POINTS_SAVE_FOR_PARTNER + POINTS_PROMPT_CERTIFIED);

    // Step 5 — B taps "I tried it" → startRoleplay. Picks a gratitude
    // prompt via the same library the UI would use.
    const picked = pickPromptWeighted(GRATITUDE_LIBRARY, { random: () => 0 });
    const { sessionId } = await startRoleplay({
      exec: b.exec,
      engine: b.engine,
      enactorPubkey: B_PUB,
      curatorPubkey: A_PUB,
      savedPostId: unlock!.savedPostId,
      gratitudePromptKey: picked.prompt.key,
      gratitudePromptTitle: picked.prompt.title,
      gratitudePromptBody: picked.prompt.body,
    });
    await syncBoth(a, b);

    // Step 6 — A (curator) submits the private rating.
    await setRoleplayRating({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      actorPubkey: A_PUB,
      rating: 9,
    });
    await syncBoth(a, b);
    expect((await findRoleplaySession(a.exec, sessionId))!.rating).toBe(9);
    expect((await findRoleplaySession(b.exec, sessionId))!.rating).toBe(9);

    // Step 7 — Each side marks their own gratitude step. We do them
    // before sync so each side only has its own done_at locally — the
    // sweeper has to close the loop on the next sync cycle (the
    // markGratitudeStep call won't see "both done" locally yet).
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

    // Step 8 — Sync. The runSyncCycle includes sweepCompletedLoops, so
    // the +25 lands on whichever side(s) the closed loop becomes
    // visible to first. Two cycles each to catch the case where the
    // sweeper sees the closed loop on the second pass.
    await runSyncCycle(a.engine);
    await runSyncCycle(b.engine);
    await runSyncCycle(a.engine);
    await runSyncCycle(b.engine);

    // Step 9 — Final acceptance. Both sides land at +37, the role-play
    // session shows rating=9 + both gratitude done, and the unlocked
    // saved_post is linked to the certified prompt.
    const expected = POINTS_SAVE_FOR_PARTNER + POINTS_PROMPT_CERTIFIED + POINTS_LOOP_COMPLETED;
    expect(await sumCouplePoints(a.exec)).toBe(expected);
    expect(await sumCouplePoints(b.exec)).toBe(expected);

    const sessionA = await findRoleplaySession(a.exec, sessionId);
    const sessionB = await findRoleplaySession(b.exec, sessionId);
    expect(sessionA!.rating).toBe(9);
    expect(sessionB!.rating).toBe(9);
    expect(sessionA!.gratitudeEnactorDoneAt).not.toBeNull();
    expect(sessionA!.gratitudeCuratorDoneAt).not.toBeNull();
    expect(sessionB!.gratitudeEnactorDoneAt).not.toBeNull();
    expect(sessionB!.gratitudeCuratorDoneAt).not.toBeNull();
  });

  it('rating plaintext never appears in any relay envelope (server-cannot-decrypt invariant)', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    // Drive enough of the loop to put a rating onto the wire.
    await saveForPartner({
      exec: a.exec,
      engine: a.engine,
      globalPostId: GLOBAL_POST_ID,
      savedByPubkey: A_PUB,
      savedForPubkey: B_PUB,
    });
    const { promptId } = await assignPromptForPartner({
      exec: a.exec,
      engine: a.engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      random: () => 0,
    });
    await syncBoth(a, b);
    await markPromptCompleted({
      exec: b.exec,
      engine: b.engine,
      promptId,
      actorPubkey: B_PUB,
    });
    await syncBoth(a, b);
    await certifyPromptCompletion({
      exec: a.exec,
      engine: a.engine,
      promptId,
      actorPubkey: A_PUB,
    });
    const unlock = await unlockOneRandomFor({
      exec: a.exec,
      engine: a.engine,
      assigneePubkey: B_PUB,
      unlockPromptId: promptId,
      random: () => 0,
    });
    await syncBoth(a, b);
    const picked = pickPromptWeighted(GRATITUDE_LIBRARY, { random: () => 0 });
    const { sessionId } = await startRoleplay({
      exec: b.exec,
      engine: b.engine,
      enactorPubkey: B_PUB,
      curatorPubkey: A_PUB,
      savedPostId: unlock!.savedPostId,
      gratitudePromptKey: picked.prompt.key,
      gratitudePromptTitle: picked.prompt.title,
      gratitudePromptBody: picked.prompt.body,
    });
    await syncBoth(a, b);
    await setRoleplayRating({
      exec: a.exec,
      engine: a.engine,
      sessionId,
      actorPubkey: A_PUB,
      rating: 7,
    });
    await a.engine.flush();

    // The relay sees only ratchet ciphertext + headers. The plaintext
    // op (which carries "rating":7) must not appear anywhere in the
    // base64 fields. The ratchet test in couple-protocol covers the
    // same invariant from the crypto side; we re-verify here from the
    // mobile side after the whole loop has run so a regression
    // anywhere in the projector → engine → relay stack still surfaces.
    for (const env of relay.rows) {
      expect(env.envelope.ciphertext).not.toContain('rating');
      expect(env.envelope.ciphertext).not.toContain('"7"');
      expect(env.envelope.header).not.toContain('rating');
    }
  });
});
