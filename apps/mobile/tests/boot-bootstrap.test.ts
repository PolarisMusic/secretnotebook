import { describe, expect, it, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../src/db/executor';
import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { bootstrap, type BootDeps } from '../src/features/boot/bootstrap';
import { persistCouple } from '../src/features/pairing/persistence';
import type { KeychainAdapter } from '../src/security/keychain';
import { deriveSqlcipherKey } from '../src/security/sqlcipher-key';
import { nodeExecutor } from './helpers/sqlite-executor';

function inMemoryKeychain(): KeychainAdapter & { peek(): Uint8Array | null } {
  let stored: Uint8Array | null = null;
  return {
    async hasDeviceMaster() {
      return stored !== null;
    },
    async saveDeviceMaster(master) {
      stored = master;
    },
    async loadDeviceMaster() {
      return stored;
    },
    async clearDeviceMaster() {
      stored = null;
    },
    peek() {
      return stored;
    },
  };
}

function fakeRandomBytes(): (n: number) => Uint8Array {
  let counter = 0xaa;
  return (n) => {
    const out = new Uint8Array(n);
    out.fill(counter++);
    return out;
  };
}

interface BootHarness {
  deps: BootDeps;
  openCalls: Uint8Array[];
  executor: SqlExecutor;
}

function harness(keychain: KeychainAdapter, randomBytes = fakeRandomBytes()): BootHarness {
  const db = new Database(':memory:');
  const executor = nodeExecutor(db);
  const openCalls: Uint8Array[] = [];
  return {
    executor,
    openCalls,
    deps: {
      keychain,
      randomBytes,
      openDatabase: async (encryptionKey) => {
        openCalls.push(encryptionKey);
        return { executor };
      },
      runMigrations: (exec) => runMigrations(exec, MIGRATIONS).then(() => undefined),
    },
  };
}

describe('bootstrap', () => {
  it('generates and stores a device_master on first launch, opens the DB with the HKDF-derived key', async () => {
    const kc = inMemoryKeychain();
    const h = harness(kc);

    const result = await bootstrap(h.deps);
    expect(result.couple).toBeNull();
    expect(kc.peek()).not.toBeNull();

    const master = kc.peek() as Uint8Array;
    const expectedKey = await deriveSqlcipherKey(master);
    expect(h.openCalls).toHaveLength(1);
    expect(bytesToHex(h.openCalls[0] as Uint8Array)).toBe(bytesToHex(expectedKey));
  });

  it('reuses the stored device_master on subsequent boots', async () => {
    const kc = inMemoryKeychain();
    const h1 = harness(kc);
    await bootstrap(h1.deps);
    const masterAfterFirst = kc.peek();

    const h2 = harness(kc);
    await bootstrap(h2.deps);
    expect(kc.peek()).toBe(masterAfterFirst);
    expect(h2.openCalls).toHaveLength(1);
    expect(bytesToHex(h2.openCalls[0] as Uint8Array)).toBe(
      bytesToHex(h1.openCalls[0] as Uint8Array),
    );
  });

  it('exposes the couple row once one exists', async () => {
    const kc = inMemoryKeychain();
    const h = harness(kc);
    // Pre-seed a couple in the very executor the harness will return.
    await runMigrations(h.executor, MIGRATIONS);
    const rootKey = new Uint8Array(32).fill(0xcd);
    const selfPub = new Uint8Array(32).fill(0x10);
    const peerPub = new Uint8Array(32).fill(0x20);
    const { coupleId } = await persistCouple(h.executor, { rootKey, selfPub, peerPub });

    const result = await bootstrap(h.deps);
    expect(result.couple?.coupleId).toBe(coupleId);
    expect(result.couple?.status).toBe('awaiting_safeword');
  });

  it('derives a stable device signing keypair from the same device_master across boots', async () => {
    const kc = inMemoryKeychain();
    const r1 = await bootstrap(harness(kc).deps);
    const r2 = await bootstrap(harness(kc).deps);
    expect(Array.from(r1.deviceSigningKey.publicKey)).toEqual(
      Array.from(r2.deviceSigningKey.publicKey),
    );
    expect(r1.deviceSigningKey.publicKey.length).toBe(32);
    expect(r1.deviceSigningKey.privateKey.length).toBe(64);
  });

  it('surfaces a keychain error verbatim (caller is responsible for retry UX)', async () => {
    const broken: KeychainAdapter = {
      hasDeviceMaster: async () => false,
      loadDeviceMaster: async () => null,
      saveDeviceMaster: async () => {
        throw new Error('biometric denied');
      },
      clearDeviceMaster: async () => undefined,
    };
    const h = harness(broken);
    await expect(bootstrap(h.deps)).rejects.toThrow(/biometric denied/);
  });

  it('surfaces a migration error verbatim', async () => {
    const kc = inMemoryKeychain();
    const db = new Database(':memory:');
    const executor = nodeExecutor(db);
    const failingMigrations = jest.fn(async () => {
      throw new Error('migration boom');
    });
    await expect(
      bootstrap({
        keychain: kc,
        randomBytes: fakeRandomBytes(),
        openDatabase: async () => ({ executor }),
        runMigrations: failingMigrations,
      }),
    ).rejects.toThrow(/migration boom/);
    expect(failingMigrations).toHaveBeenCalledTimes(1);
  });
});
