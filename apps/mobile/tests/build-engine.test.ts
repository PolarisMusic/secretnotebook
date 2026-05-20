import { describe, expect, it } from '@jest/globals';
import { generateEd25519KeyPair } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { ApiClient } from '../src/features/api/client';
import {
  loadCoupleSyncMaterial,
  tryBuildSyncEngine,
} from '../src/features/couple-channel/build-engine';
import { initAndSaveRatchet } from '../src/features/couple-channel/ratchet-store';
import { nodeExecutor } from './helpers/sqlite-executor';

const COUPLE_ID = '11111111-1111-1111-1111-111111111111';
const ROOT_KEY = new Uint8Array(32).fill(0xab);
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);

async function freshDb(status: 'awaiting_safeword' | 'paired' = 'paired'): Promise<{
  exec: ReturnType<typeof nodeExecutor>;
}> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  await exec.execute(
    `INSERT INTO couple (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [COUPLE_ID, A_PUB, B_PUB, ROOT_KEY, 1_700_000_000, status],
  );
  return { exec };
}

async function freshApi(): Promise<ApiClient> {
  return new ApiClient({
    baseUrl: 'http://test',
    keyPair: await generateEd25519KeyPair(),
    fetch: async () => ({ status: 200, text: async () => '{}' }),
  });
}

describe('loadCoupleSyncMaterial', () => {
  it('returns the key material for a paired couple', async () => {
    const { exec } = await freshDb('paired');
    const m = await loadCoupleSyncMaterial(exec, COUPLE_ID);
    expect(m).not.toBeNull();
    expect(m!.coupleId).toBe(COUPLE_ID);
    expect(Array.from(m!.coupleRoot)).toEqual(Array.from(ROOT_KEY));
    expect(Array.from(m!.partnerA)).toEqual(Array.from(A_PUB));
    expect(Array.from(m!.partnerB)).toEqual(Array.from(B_PUB));
  });

  it('returns null when the couple is still awaiting_safeword', async () => {
    const { exec } = await freshDb('awaiting_safeword');
    expect(await loadCoupleSyncMaterial(exec, COUPLE_ID)).toBeNull();
  });

  it('returns null when no row matches the id', async () => {
    const { exec } = await freshDb('paired');
    expect(await loadCoupleSyncMaterial(exec, 'no-such-couple')).toBeNull();
  });
});

describe('tryBuildSyncEngine', () => {
  it('returns an engine wired to side a when the smaller pubkey is selfPub', async () => {
    const { exec } = await freshDb('paired');
    const api = await freshApi();
    await initAndSaveRatchet(exec, {
      coupleId: COUPLE_ID,
      rootKey: ROOT_KEY,
      selfPub: A_PUB,
      peerPub: B_PUB,
    });
    const engine = await tryBuildSyncEngine({ exec, api, coupleId: COUPLE_ID });
    expect(engine).not.toBeNull();
  });

  it('returns an engine wired to side b when this device is the larger pubkey', async () => {
    const { exec } = await freshDb('paired');
    const api = await freshApi();
    await initAndSaveRatchet(exec, {
      coupleId: COUPLE_ID,
      rootKey: ROOT_KEY,
      selfPub: B_PUB,
      peerPub: A_PUB,
    });
    const engine = await tryBuildSyncEngine({ exec, api, coupleId: COUPLE_ID });
    expect(engine).not.toBeNull();
  });

  it('returns null when there is no ratchet row yet', async () => {
    const { exec } = await freshDb('paired');
    const api = await freshApi();
    expect(await tryBuildSyncEngine({ exec, api, coupleId: COUPLE_ID })).toBeNull();
  });

  it('returns null when the couple is not paired yet (Safe Word still required)', async () => {
    const { exec } = await freshDb('awaiting_safeword');
    const api = await freshApi();
    await initAndSaveRatchet(exec, {
      coupleId: COUPLE_ID,
      rootKey: ROOT_KEY,
      selfPub: A_PUB,
      peerPub: B_PUB,
    });
    expect(await tryBuildSyncEngine({ exec, api, coupleId: COUPLE_ID })).toBeNull();
  });
});
