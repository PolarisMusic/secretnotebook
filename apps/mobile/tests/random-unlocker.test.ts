import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import type { Prompt } from '@secretnotebook/prompt-library';
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
import { listUnlockedForMe } from '../src/features/couple-channel/saved-post-store';
import { SyncEngine } from '../src/features/couple-channel/sync-engine';
import { assignPromptForPartner } from '../src/features/prompts/assigner';
import { certifyPromptCompletion, markPromptCompleted } from '../src/features/prompts/transitions';
import { unlockOneRandomFor } from '../src/features/saved-posts/random-unlocker';
import { nodeExecutor } from './helpers/sqlite-executor';

const ROOT_KEY = new Uint8Array(32).fill(0xab);
const COUPLE_ID = '11111111-1111-1111-1111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);
const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');

const TINY_LIBRARY: Prompt[] = [
  { key: 'p-one', title: 'P-One', body: 'aaaaaaaaaa', suggestedAssignee: 'either', tags: [] },
  { key: 'p-two', title: 'P-Two', body: 'bbbbbbbbbb', suggestedAssignee: 'either', tags: [] },
];

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

describe('unlockOneRandomFor — picks exactly one locked saved_post', () => {
  it('marks the chosen row unlocked locally and enqueues the op', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    // A saves three posts for B (the assignee in our scenario).
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

    const result = await unlockOneRandomFor({
      exec: a.exec,
      engine: a.engine,
      assigneePubkey: B_PUB,
      unlockPromptId: '99999999-9999-9999-9999-999999999999',
      random: () => 0, // pick the first candidate (lex-smallest id)
      now: () => 1_700_000_900,
    });
    expect(result).not.toBeNull();

    // Local effect: exactly one row unlocked, and it carries the prompt id.
    const unlocked = await a.exec.query<{
      id: string;
      unlocked_at: number;
      unlock_prompt_id: string;
    }>(`SELECT id, unlocked_at, unlock_prompt_id FROM saved_post WHERE unlocked_at IS NOT NULL`);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]!.id).toBe(result!.savedPostId);
    expect(unlocked[0]!.unlocked_at).toBe(1_700_000_900);
    expect(unlocked[0]!.unlock_prompt_id).toBe('99999999-9999-9999-9999-999999999999');
  });

  it('returns null when no locked candidates exist for the assignee', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const result = await unlockOneRandomFor({
      exec: a.exec,
      engine: a.engine,
      assigneePubkey: B_PUB,
      unlockPromptId: '99999999-9999-9999-9999-999999999999',
    });
    expect(result).toBeNull();
  });

  it('is idempotent — a second call with the same unlockPromptId is a no-op', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
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
    const first = await unlockOneRandomFor({
      exec: a.exec,
      engine: a.engine,
      assigneePubkey: B_PUB,
      unlockPromptId: '99999999-9999-9999-9999-999999999999',
      random: () => 0,
    });
    expect(first).not.toBeNull();

    const second = await unlockOneRandomFor({
      exec: a.exec,
      engine: a.engine,
      assigneePubkey: B_PUB,
      unlockPromptId: '99999999-9999-9999-9999-999999999999',
      random: () => 0,
    });
    expect(second).toBeNull();

    // Only ONE row is unlocked overall.
    const unlocked = await a.exec.query<{ id: string }>(
      `SELECT id FROM saved_post WHERE unlocked_at IS NOT NULL`,
    );
    expect(unlocked).toHaveLength(1);
  });

  it('rejects wrong-size assigneePubkey before doing anything', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    await expect(
      unlockOneRandomFor({
        exec: a.exec,
        engine: a.engine,
        assigneePubkey: new Uint8Array(16),
        unlockPromptId: '99999999-9999-9999-9999-999999999999',
      }),
    ).rejects.toThrow(/assigneePubkey/);
  });
});

describe('end-to-end — certify → random unlock → partner sees the unlocked tile', () => {
  it("flips one of the assignee's locked saved_posts to unlocked after the certifier picks", async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    // A saves two posts FOR B (B is the would-be assignee).
    for (const id of [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]) {
      await saveForPartner({
        exec: a.exec,
        engine: a.engine,
        globalPostId: id,
        savedByPubkey: A_PUB,
        savedForPubkey: B_PUB,
      });
    }
    await a.engine.flush();
    await b.engine.pull();

    // A assigns B a prompt; B completes it.
    const { promptId } = await assignPromptForPartner({
      exec: a.exec,
      engine: a.engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      random: () => 0,
    });
    await a.engine.flush();
    await b.engine.pull();
    await markPromptCompleted({
      exec: b.exec,
      engine: b.engine,
      promptId,
      actorPubkey: B_PUB,
      now: () => 1_700_000_500,
    });
    await b.engine.flush();
    await a.engine.pull();

    // A (non-assignee) certifies + picks one of B's locked posts to unlock.
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
    await a.engine.flush();
    await b.engine.pull();

    // B sees the unlock: exactly one of their saved-for-me rows is now
    // unlocked, and unlock_prompt_id points at the cert prompt.
    const unlockedForB = await listUnlockedForMe(b.exec, B_PUB);
    expect(unlockedForB).toHaveLength(1);
    expect(unlockedForB[0]!.id).toBe(unlock!.savedPostId);
    expect(unlockedForB[0]!.unlockPromptId).toBe(promptId);
    expect(unlockedForB[0]!.unlockedAt).toBe(1_700_000_701);
  });
});

describe('exactly-one-unlock invariant under concurrent merges', () => {
  it('two concurrent certifications by different prompts unlock two distinct posts', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    // Each side saves two posts for the OTHER side. Then each side
    // certifies the other's prompt: A certifies B's prompt → unlocks
    // one of A's saved-for-B posts; B certifies A's prompt → unlocks
    // one of B's saved-for-A posts.
    for (const id of [
      'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      'aaaaaaaa-2222-2222-2222-aaaaaaaaaaaa',
    ]) {
      await saveForPartner({
        exec: a.exec,
        engine: a.engine,
        globalPostId: id,
        savedByPubkey: A_PUB,
        savedForPubkey: B_PUB,
      });
    }
    for (const id of [
      'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb',
      'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
    ]) {
      await saveForPartner({
        exec: b.exec,
        engine: b.engine,
        globalPostId: id,
        savedByPubkey: B_PUB,
        savedForPubkey: A_PUB,
      });
    }
    await a.engine.flush();
    await b.engine.flush();
    await a.engine.pull();
    await b.engine.pull();

    // P1: A → B (B is assignee). P2: B → A (A is assignee).
    const p1 = await assignPromptForPartner({
      exec: a.exec,
      engine: a.engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      random: () => 0,
    });
    const p2 = await assignPromptForPartner({
      exec: b.exec,
      engine: b.engine,
      assignedToPubkey: A_PUB,
      assignedByPubkey: B_PUB,
      library: TINY_LIBRARY,
      random: () => 0.5,
    });
    await a.engine.flush();
    await b.engine.flush();
    await a.engine.pull();
    await b.engine.pull();

    // Each completes their own assignment.
    await markPromptCompleted({
      exec: b.exec,
      engine: b.engine,
      promptId: p1.promptId,
      actorPubkey: B_PUB,
    });
    await markPromptCompleted({
      exec: a.exec,
      engine: a.engine,
      promptId: p2.promptId,
      actorPubkey: A_PUB,
    });
    await a.engine.flush();
    await b.engine.flush();
    await a.engine.pull();
    await b.engine.pull();

    // Concurrent certify + unlock: A certifies P1 (B's prompt) and
    // picks one of B's locked posts; B certifies P2 (A's prompt) and
    // picks one of A's locked posts.
    await certifyPromptCompletion({
      exec: a.exec,
      engine: a.engine,
      promptId: p1.promptId,
      actorPubkey: A_PUB,
    });
    const u1 = await unlockOneRandomFor({
      exec: a.exec,
      engine: a.engine,
      assigneePubkey: B_PUB,
      unlockPromptId: p1.promptId,
      random: () => 0,
      now: () => 1_700_000_800,
    });
    await certifyPromptCompletion({
      exec: b.exec,
      engine: b.engine,
      promptId: p2.promptId,
      actorPubkey: B_PUB,
    });
    const u2 = await unlockOneRandomFor({
      exec: b.exec,
      engine: b.engine,
      assigneePubkey: A_PUB,
      unlockPromptId: p2.promptId,
      random: () => 0,
      now: () => 1_700_000_801,
    });
    await a.engine.flush();
    await b.engine.flush();
    await a.engine.pull();
    await b.engine.pull();

    expect(u1).not.toBeNull();
    expect(u2).not.toBeNull();
    // Different rows on different sides — they belong to different
    // saved_for_pubkey buckets so they can't overlap.
    expect(u1!.savedPostId).not.toBe(u2!.savedPostId);

    // B sees one unlocked-for-me row; A sees one unlocked-for-me row.
    const unlockedForB = await listUnlockedForMe(b.exec, B_PUB);
    const unlockedForA = await listUnlockedForMe(a.exec, A_PUB);
    expect(unlockedForB).toHaveLength(1);
    expect(unlockedForA).toHaveLength(1);
    expect(unlockedForB[0]!.unlockPromptId).toBe(p1.promptId);
    expect(unlockedForA[0]!.unlockPromptId).toBe(p2.promptId);
  });
});
