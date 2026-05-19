import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';

import { deriveSqlcipherKey, SQLCIPHER_KEY_BYTES } from '../src/security/sqlcipher-key';

describe('deriveSqlcipherKey', () => {
  it('is deterministic for the same device_master', async () => {
    const master = new Uint8Array(32).fill(7);
    const a = await deriveSqlcipherKey(master);
    const b = await deriveSqlcipherKey(master);
    expect(a.length).toBe(SQLCIPHER_KEY_BYTES);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('produces different output for different masters', async () => {
    const m1 = new Uint8Array(32).fill(7);
    const m2 = new Uint8Array(32).fill(8);
    const a = await deriveSqlcipherKey(m1);
    const b = await deriveSqlcipherKey(m2);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('rejects a device_master that is not 32 bytes', async () => {
    await expect(deriveSqlcipherKey(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
    await expect(deriveSqlcipherKey(new Uint8Array(64))).rejects.toThrow(/32 bytes/);
  });
});
