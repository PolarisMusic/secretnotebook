import { describe, expect, it } from '@jest/globals';
import type { Prompt } from '@secretnotebook/prompt-library';
import type {
  RelayDeleteResponse,
  RelayPostResponse,
  ReceivedSyncEnvelope,
  SyncEnvelope,
  SyncEnvelopeList,
} from '@secretnotebook/shared-types';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { ApiClient } from '../src/features/api/client';
import { initAndSaveRatchet } from '../src/features/couple-channel/ratchet-store';
import { SyncEngine } from '../src/features/couple-channel/sync-engine';
import { assignPromptForPartner } from '../src/features/prompts/assigner';
import { findPromptById } from '../src/features/prompts/store';
import { certifyPromptCompletion, markPromptCompleted } from '../src/features/prompts/transitions';
import { nodeExecutor } from './helpers/sqlite-executor';

const ROOT_KEY = new Uint8Array(32).fill(0xab);
const COUPLE_ID = '11111111-1111-1111-1111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);
const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');

const TINY_LIBRARY: Prompt[] = [
  { key: 'p-one', title: 'P-One', body: 'aaaaaaaaaa', suggestedAssignee: 'either', tags: [] },
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
    side: args.selfPub === A_PUB ? 'a' : 'b',
    now: () => FIXED_NOW,
  });
  return { exec, engine };
}

describe('markPromptCompleted — only the assignee can transition assigned → completed', () => {
  it('flips state to completed when fired by the assignee', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    // A assigns to B; B is the assignee.
    const { promptId } = await assignPromptForPartner({
      exec: a.exec,
      engine: a.engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      random: () => 0,
    });
    // B picks it up, marks done.
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
    await a.engine.flush();
    await b.engine.pull();
    await markPromptCompleted({
      exec: b.exec,
      engine: b.engine,
      promptId,
      actorPubkey: B_PUB,
      now: () => 1_700_000_500,
    });
    const onB = await findPromptById(b.exec, promptId);
    expect(onB!.state).toBe('completed');
    expect(onB!.completedAt).toBe(1_700_000_500);
  });

  it('is a no-op when fired by the non-assignee (wrong actor)', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const { promptId } = await assignPromptForPartner({
      exec: a.exec,
      engine: a.engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      random: () => 0,
    });
    // A tries to mark their own assignment complete on their own DB.
    await markPromptCompleted({
      exec: a.exec,
      engine: a.engine,
      promptId,
      actorPubkey: A_PUB,
    });
    const onA = await findPromptById(a.exec, promptId);
    expect(onA!.state).toBe('assigned'); // unchanged
  });
});

describe('certifyPromptCompletion — only the non-assignee can transition completed → certified', () => {
  it('marks certified after the assignee has completed', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
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

    // Now A (non-assignee) certifies.
    await certifyPromptCompletion({
      exec: a.exec,
      engine: a.engine,
      promptId,
      actorPubkey: A_PUB,
      now: () => 1_700_000_700,
    });
    const onA = await findPromptById(a.exec, promptId);
    expect(onA!.state).toBe('certified');
    expect(onA!.certifiedAt).toBe(1_700_000_700);

    // After sync the certification lands on B too.
    await a.engine.flush();
    await b.engine.pull();
    const onB = await findPromptById(b.exec, promptId);
    expect(onB!.state).toBe('certified');
    expect(onB!.certifiedAt).toBe(1_700_000_700);
  });

  it('cannot certify before completion — the WHERE guard makes it a no-op', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const { promptId } = await assignPromptForPartner({
      exec: a.exec,
      engine: a.engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      random: () => 0,
    });
    // A attempts to certify before B has completed.
    await certifyPromptCompletion({
      exec: a.exec,
      engine: a.engine,
      promptId,
      actorPubkey: A_PUB,
    });
    const onA = await findPromptById(a.exec, promptId);
    expect(onA!.state).toBe('assigned'); // unchanged
  });

  it('cannot certify when fired by the assignee — the actor guard makes it a no-op', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
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
    });
    // B (the assignee) tries to certify their own prompt — should be a no-op.
    await certifyPromptCompletion({
      exec: b.exec,
      engine: b.engine,
      promptId,
      actorPubkey: B_PUB,
    });
    const onB = await findPromptById(b.exec, promptId);
    expect(onB!.state).toBe('completed'); // still completed, NOT certified
  });
});

describe('end-to-end — a prompt cannot reach certified without both sides acting (acceptance)', () => {
  it('completion alone leaves the prompt at "completed" until the partner certifies', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
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

    // Both sides see 'completed'; nobody has certified yet.
    expect((await findPromptById(a.exec, promptId))!.state).toBe('completed');
    expect((await findPromptById(b.exec, promptId))!.state).toBe('completed');
  });
});
