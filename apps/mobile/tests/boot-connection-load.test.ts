import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { persistConnection } from '../src/features/pairing/persistence';
import { loadActiveConnection, loadConnectionRootKey } from '../src/features/boot/connection-load';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshDb() {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return { db, exec };
}

describe('loadActiveConnection', () => {
  it('returns null on a fresh database (no connection yet)', async () => {
    const { exec } = await freshDb();
    expect(await loadActiveConnection(exec)).toBeNull();
  });

  it('returns the persisted connection row with its status', async () => {
    const { exec } = await freshDb();
    const rootKey = new Uint8Array(32).fill(0xaa);
    const selfPub = new Uint8Array(32).fill(0x01);
    const peerPub = new Uint8Array(32).fill(0x02);
    const { connectionId } = await persistConnection(exec, { rootKey, selfPub, peerPub });

    const active = await loadActiveConnection(exec);
    expect(active).not.toBeNull();
    expect(active?.connectionId).toBe(connectionId);
    expect(active?.status).toBe('awaiting_safeword');
  });

  it('ignores a row with an unexpected status (defensive against corruption)', async () => {
    // CHECK constraints enforce known statuses at INSERT/UPDATE time, so a
    // bogus value can only arrive via raw query results. Feed the loader a
    // fake executor that yields one to confirm it returns null instead of
    // crashing.
    const fakeExec = {
      executeBatch: async () => undefined,
      execute: async () => undefined,
      query: async () => [{ id: 'cid', status: 'gibberish' }] as never,
      transaction: async <T>(fn: () => Promise<T>) => fn(),
    };
    expect(await loadActiveConnection(fakeExec)).toBeNull();
  });
});

describe('loadConnectionRootKey', () => {
  it('re-hydrates the root key persisted at pairing time', async () => {
    const { exec } = await freshDb();
    const rootKey = new Uint8Array(32).fill(0xab);
    const selfPub = new Uint8Array(32).fill(0x01);
    const peerPub = new Uint8Array(32).fill(0x02);
    const { connectionId } = await persistConnection(exec, { rootKey, selfPub, peerPub });

    const loaded = await loadConnectionRootKey(exec, connectionId);
    expect(loaded).not.toBeNull();
    expect(loaded).toBeInstanceOf(Uint8Array);
    expect(loaded && Array.from(loaded)).toEqual(Array.from(rootKey));
  });

  it('returns null for an unknown connection id', async () => {
    const { exec } = await freshDb();
    expect(await loadConnectionRootKey(exec, 'nosuchid')).toBeNull();
  });

  it('returns null when the stored key is the wrong size (defensive)', async () => {
    const fakeExec = {
      executeBatch: async () => undefined,
      execute: async () => undefined,
      query: async () => [{ channel_root_key_wrapped: new Uint8Array(8) }] as never,
      transaction: async <T>(fn: () => Promise<T>) => fn(),
    };
    expect(await loadConnectionRootKey(fakeExec, 'cid')).toBeNull();
  });
});
