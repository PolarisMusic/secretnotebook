import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_SAFEWORD_PARAMS,
  deriveSafeWordVerifier,
  generateSafeWordSalt,
  SAFEWORD_MEMLIMIT,
  SAFEWORD_OPSLIMIT,
  SAFEWORD_SALT_BYTES,
  SAFEWORD_VERIFIER_BYTES,
  verifySafeWord,
} from '../src/safeword.js';
import { bytesToHex } from '../src/sodium.js';

const FAST_PARAMS = { opslimit: 2, memlimit: 64 * 1024 * 1024 };

describe('safeword KDF', () => {
  it('exposes the documented Argon2id parameters as defaults (m=64MB, t=3)', () => {
    expect(DEFAULT_SAFEWORD_PARAMS.opslimit).toBe(SAFEWORD_OPSLIMIT);
    expect(DEFAULT_SAFEWORD_PARAMS.memlimit).toBe(SAFEWORD_MEMLIMIT);
    expect(SAFEWORD_OPSLIMIT).toBe(3);
    expect(SAFEWORD_MEMLIMIT).toBe(64 * 1024 * 1024);
  });

  it('derives a deterministic verifier for the same word + salt', async () => {
    const salt = new Uint8Array(SAFEWORD_SALT_BYTES);
    salt[0] = 1;
    const a = await deriveSafeWordVerifier('forest-river-quartz', salt, FAST_PARAMS);
    const b = await deriveSafeWordVerifier('forest-river-quartz', salt, FAST_PARAMS);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    expect(a.length).toBe(SAFEWORD_VERIFIER_BYTES);
  });

  it('produces different verifiers for different safewords', async () => {
    const salt = new Uint8Array(SAFEWORD_SALT_BYTES);
    const a = await deriveSafeWordVerifier('alpha', salt, FAST_PARAMS);
    const b = await deriveSafeWordVerifier('beta', salt, FAST_PARAMS);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('produces different verifiers for different salts', async () => {
    const s1 = new Uint8Array(SAFEWORD_SALT_BYTES);
    const s2 = new Uint8Array(SAFEWORD_SALT_BYTES);
    s2[0] = 0xff;
    const a = await deriveSafeWordVerifier('same', s1, FAST_PARAMS);
    const b = await deriveSafeWordVerifier('same', s2, FAST_PARAMS);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('verifies a correct safeword and rejects a wrong one', async () => {
    const salt = await generateSafeWordSalt();
    expect(salt.length).toBe(SAFEWORD_SALT_BYTES);
    const stored = await deriveSafeWordVerifier('orchid-canyon-saffron', salt, FAST_PARAMS);

    expect(await verifySafeWord('orchid-canyon-saffron', salt, stored, FAST_PARAMS)).toBe(true);
    expect(await verifySafeWord('orchid-canyon-saffrom', salt, stored, FAST_PARAMS)).toBe(false);
  });

  it('normalizes NFKC so visually-equal inputs match', async () => {
    const salt = new Uint8Array(SAFEWORD_SALT_BYTES);
    const composed = 'éclipse';
    const decomposed = 'éclipse';
    const a = await deriveSafeWordVerifier(composed, salt, FAST_PARAMS);
    const b = await deriveSafeWordVerifier(decomposed, salt, FAST_PARAMS);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('rejects empty safeword and wrong-size salt', async () => {
    const salt = new Uint8Array(SAFEWORD_SALT_BYTES);
    await expect(deriveSafeWordVerifier('', salt, FAST_PARAMS)).rejects.toThrow(/empty/);
    await expect(deriveSafeWordVerifier('x', new Uint8Array(8), FAST_PARAMS)).rejects.toThrow(
      /salt/,
    );
  });

  it('verifySafeWord returns false on wrong-size stored verifier', async () => {
    const salt = new Uint8Array(SAFEWORD_SALT_BYTES);
    expect(await verifySafeWord('x', salt, new Uint8Array(16), FAST_PARAMS)).toBe(false);
  });
});
