import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import type { Prompt } from '@secretnotebook/prompt-library';
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
import { SyncEngine } from '../src/features/couple-channel/sync-engine';
import { assignPromptForPartner, listRecentLibraryKeys } from '../src/features/prompts/assigner';
import { findPromptById, listMyActivePrompts } from '../src/features/prompts/store';
import { nodeExecutor } from './helpers/sqlite-executor';

const ROOT_KEY = new Uint8Array(32).fill(0xab);
const COUPLE_ID = '11111111-1111-1111-1111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);

const TINY_LIBRARY: Prompt[] = [
  { key: 'one', title: 'One', body: 'aaaaaaaaaa', suggestedAssignee: 'either', tags: [] },
  { key: 'two', title: 'Two', body: 'bbbbbbbbbb', suggestedAssignee: 'either', tags: [] },
  { key: 'three', title: 'Three', body: 'cccccccccc', suggestedAssignee: 'either', tags: [] },
];

class StubRelay {
  rows: SyncEnvelope[] = [];
  apiFor(): Pick<ApiClient, 'postEnvelope' | 'listEnvelopes' | 'deleteEnvelope'> {
    return {
      postEnvelope: async (_id: string, envelope: SyncEnvelope): Promise<RelayPostResponse> => {
        this.rows.push(envelope);
        return {
          id: '00000000-0000-0000-0000-000000000001',
          receivedAt: '2026-05-20T00:00:00.000Z',
          expiresAt: '2026-06-20T00:00:00.000Z',
        };
      },
      listEnvelopes: async (): Promise<SyncEnvelopeList> => ({ items: [], nextCursor: null }),
      deleteEnvelope: async (): Promise<RelayDeleteResponse> => ({ ok: true as const }),
    };
  }
}

async function freshSide(): Promise<{
  exec: ReturnType<typeof nodeExecutor>;
  engine: SyncEngine;
  relay: StubRelay;
}> {
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
    selfPub: A_PUB,
    peerPub: B_PUB,
  });
  const relay = new StubRelay();
  const engine = new SyncEngine({
    exec,
    api: relay.apiFor() as unknown as ApiClient,
    coupleId: COUPLE_ID,
    coupleRoot: ROOT_KEY,
    selfPub: A_PUB,
    peerPub: B_PUB,
    side: 'a',
    now: () => new Date('2026-05-20T12:00:00.000Z'),
  });
  return { exec, engine, relay };
}

describe('assignPromptForPartner', () => {
  it('writes a local prompt row in state=assigned and returns the picked key', async () => {
    const { exec, engine } = await freshSide();
    const out = await assignPromptForPartner({
      exec,
      engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      random: () => 0, // first eligible candidate
      now: () => 1_700_000_500,
    });
    expect(out.libraryKey).toBe('one');
    expect(out.op.kind).toBe('prompt.assign');
    expect(out.op.libraryKey).toBe('one');
    expect(out.op.assignedToPubkey).toBe(bytesToHex(B_PUB));
    expect(out.op.assignedByPubkey).toBe(bytesToHex(A_PUB));

    const stored = await findPromptById(exec, out.promptId);
    expect(stored).not.toBeNull();
    expect(stored!.state).toBe('assigned');
    expect(stored!.libraryKey).toBe('one');
    expect(stored!.completedAt).toBeNull();
    expect(stored!.certifiedAt).toBeNull();
  });

  it('enqueues exactly one prompt.assign envelope', async () => {
    const { exec, engine, relay } = await freshSide();
    await assignPromptForPartner({
      exec,
      engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      random: () => 0,
    });
    expect(relay.rows).toHaveLength(0); // not flushed yet
    const flush = await engine.flush();
    expect(flush).toEqual({ attempted: 1, delivered: 1, failed: 0 });
    expect(relay.rows).toHaveLength(1);
  });

  it('avoids the recently-assigned library keys (repeat-avoidance window)', async () => {
    const { exec, engine } = await freshSide();
    // First assign: 'one' (random=0 → first eligible).
    await assignPromptForPartner({
      exec,
      engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      avoidWindow: 5,
      random: () => 0,
    });
    // Second assign with the same random → would re-pick 'one' but it's
    // in the avoid window, so the picker filters it out and lands on
    // 'two' instead.
    const second = await assignPromptForPartner({
      exec,
      engine,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
      library: TINY_LIBRARY,
      avoidWindow: 5,
      random: () => 0,
    });
    expect(second.libraryKey).toBe('two');
  });

  it('rejects wrong-size pubkeys', async () => {
    const { exec, engine } = await freshSide();
    await expect(
      assignPromptForPartner({
        exec,
        engine,
        assignedToPubkey: new Uint8Array(16),
        assignedByPubkey: A_PUB,
        library: TINY_LIBRARY,
      }),
    ).rejects.toThrow(/assignedToPubkey/);
  });

  it('throws when every library key is in the avoid window', async () => {
    const { exec, engine } = await freshSide();
    await assignPromptForPartner({
      exec,
      engine,
      library: TINY_LIBRARY,
      avoidWindow: 5,
      random: () => 0,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
    });
    await assignPromptForPartner({
      exec,
      engine,
      library: TINY_LIBRARY,
      avoidWindow: 5,
      random: () => 0,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
    });
    await assignPromptForPartner({
      exec,
      engine,
      library: TINY_LIBRARY,
      avoidWindow: 5,
      random: () => 0,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
    });
    // Now all three keys are in the recent window.
    await expect(
      assignPromptForPartner({
        exec,
        engine,
        library: TINY_LIBRARY,
        avoidWindow: 5,
        random: () => 0,
        assignedToPubkey: B_PUB,
        assignedByPubkey: A_PUB,
      }),
    ).rejects.toThrow(/no prompt available/);
  });
});

describe('listRecentLibraryKeys', () => {
  it('returns newest-first by ROWID descending', async () => {
    const { exec, engine } = await freshSide();
    for (const key of ['one', 'two', 'three']) {
      await assignPromptForPartner({
        exec,
        engine,
        library: TINY_LIBRARY.filter((p) => p.key === key),
        random: () => 0,
        assignedToPubkey: B_PUB,
        assignedByPubkey: A_PUB,
      });
    }
    const recent = await listRecentLibraryKeys(exec, 10);
    expect(recent).toEqual(['three', 'two', 'one']);
  });

  it('caps at the requested limit', async () => {
    const { exec, engine } = await freshSide();
    for (const key of ['one', 'two', 'three']) {
      await assignPromptForPartner({
        exec,
        engine,
        library: TINY_LIBRARY.filter((p) => p.key === key),
        random: () => 0,
        assignedToPubkey: B_PUB,
        assignedByPubkey: A_PUB,
      });
    }
    expect(await listRecentLibraryKeys(exec, 2)).toEqual(['three', 'two']);
  });

  it('returns empty when n <= 0', async () => {
    const { exec } = await freshSide();
    expect(await listRecentLibraryKeys(exec, 0)).toEqual([]);
    expect(await listRecentLibraryKeys(exec, -5)).toEqual([]);
  });
});

describe('listMyActivePrompts — sanity', () => {
  it('reports a freshly assigned prompt under the assignee', async () => {
    const { exec, engine } = await freshSide();
    await assignPromptForPartner({
      exec,
      engine,
      library: TINY_LIBRARY,
      random: () => 0,
      assignedToPubkey: B_PUB,
      assignedByPubkey: A_PUB,
    });
    // From B's perspective: assigned to me.
    const forB = await listMyActivePrompts(exec, B_PUB);
    expect(forB).toHaveLength(1);
    expect(forB[0]!.state).toBe('assigned');
    // From A's perspective: nothing assigned to me.
    expect(await listMyActivePrompts(exec, A_PUB)).toHaveLength(0);
  });
});
