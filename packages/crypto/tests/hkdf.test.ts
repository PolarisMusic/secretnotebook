import { describe, expect, it } from '@jest/globals';
import { hkdfSha256, hkdfSha256Expand, hkdfSha256Extract } from '../src/hkdf.js';
import { bytesToHex, hexToBytes } from '../src/sodium.js';

describe('hkdf-sha256', () => {
  it('matches RFC 5869 §A.1 Test Case 1 (basic)', async () => {
    const ikm = hexToBytes('0b'.repeat(22));
    const salt = hexToBytes('000102030405060708090a0b0c');
    const info = hexToBytes('f0f1f2f3f4f5f6f7f8f9');

    const prk = await hkdfSha256Extract(salt, ikm);
    expect(bytesToHex(prk)).toBe(
      '077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5',
    );

    const okm = await hkdfSha256Expand(prk, info, 42);
    expect(bytesToHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf340072' + '08d5b887185865',
    );
  });

  it('matches RFC 5869 §A.2 Test Case 2 (longer inputs, 82 bytes)', async () => {
    const ikm = hexToBytes(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f' +
        '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f' +
        '404142434445464748494a4b4c4d4e4f',
    );
    const salt = hexToBytes(
      '606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f' +
        '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f' +
        'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf',
    );
    const info = hexToBytes(
      'b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf' +
        'd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef' +
        'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
    );
    const okm = await hkdfSha256(ikm, salt, info, 82);
    expect(bytesToHex(okm)).toBe(
      'b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c' +
        '59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71' +
        'cc30c58179ec3e87c14c01d5c1f3434f1d87',
    );
  });

  it('matches RFC 5869 §A.3 Test Case 3 (empty salt and info)', async () => {
    const ikm = hexToBytes('0b'.repeat(22));
    const okm = await hkdfSha256(ikm, null, new Uint8Array(0), 42);
    expect(bytesToHex(okm)).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d' + '9d201395faa4b61a96c8',
    );
  });

  it('rejects nonsensical length parameters', async () => {
    const prk = new Uint8Array(32);
    await expect(hkdfSha256Expand(prk, new Uint8Array(0), 0)).rejects.toThrow();
    await expect(hkdfSha256Expand(prk, new Uint8Array(0), 255 * 32 + 1)).rejects.toThrow();
  });
});
