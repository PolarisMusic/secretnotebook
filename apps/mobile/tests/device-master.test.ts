import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';

import { DEVICE_MASTER_BYTES, getOrCreateDeviceMaster } from '../src/security/device-master';
import type { KeychainAdapter } from '../src/security/keychain';

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

describe('getOrCreateDeviceMaster', () => {
  it('generates a fresh 32-byte master on first launch and stores it', async () => {
    const kc = inMemoryKeychain();
    const counter = { i: 0 };
    const fakeRandom = (n: number) => {
      counter.i++;
      const out = new Uint8Array(n);
      out.fill(0xaa);
      return out;
    };
    const master = await getOrCreateDeviceMaster(kc, fakeRandom);
    expect(master.length).toBe(DEVICE_MASTER_BYTES);
    expect(counter.i).toBe(1);
    expect(bytesToHex(kc.peek() as Uint8Array)).toBe(bytesToHex(master));
  });

  it('reuses the stored master on subsequent launches (no new random draw)', async () => {
    const kc = inMemoryKeychain();
    const counter = { i: 0 };
    const fakeRandom = (n: number) => {
      counter.i++;
      const out = new Uint8Array(n);
      out.fill(0x55);
      return out;
    };
    const first = await getOrCreateDeviceMaster(kc, fakeRandom);
    const second = await getOrCreateDeviceMaster(kc, fakeRandom);
    expect(bytesToHex(first)).toBe(bytesToHex(second));
    expect(counter.i).toBe(1);
  });

  it('rejects a stored master with the wrong length (likely corruption)', async () => {
    const kc = inMemoryKeychain();
    await kc.saveDeviceMaster(new Uint8Array(8));
    await expect(getOrCreateDeviceMaster(kc, (n) => new Uint8Array(n))).rejects.toThrow(
      /stored device_master/,
    );
  });

  it('rejects a random-bytes source that returns the wrong length', async () => {
    const kc = inMemoryKeychain();
    await expect(getOrCreateDeviceMaster(kc, () => new Uint8Array(8))).rejects.toThrow(
      /randomBytes/,
    );
  });
});
