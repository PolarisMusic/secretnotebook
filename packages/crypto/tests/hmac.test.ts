import { describe, expect, it } from '@jest/globals';
import { constantTimeEqual, hmacSha256, hmacSha256Verify } from '../src/hmac.js';
import { bytesToHex, hexToBytes } from '../src/sodium.js';

describe('hmac-sha256', () => {
  it('matches RFC 4231 Test Case 1', async () => {
    const key = hexToBytes('0b'.repeat(20));
    const data = new TextEncoder().encode('Hi There');
    const tag = await hmacSha256(key, data);
    expect(bytesToHex(tag)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  it('matches RFC 4231 Test Case 2', async () => {
    const key = new TextEncoder().encode('Jefe');
    const data = new TextEncoder().encode('what do ya want for nothing?');
    const tag = await hmacSha256(key, data);
    expect(bytesToHex(tag)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('verifies a correct tag and rejects a wrong one', async () => {
    const key = new Uint8Array(32);
    const data = new TextEncoder().encode('msg');
    const tag = await hmacSha256(key, data);
    expect(await hmacSha256Verify(key, data, tag)).toBe(true);
    const wrong = new Uint8Array(tag);
    wrong[0] ^= 0xff;
    expect(await hmacSha256Verify(key, data, wrong)).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical buffers', () => {
    expect(constantTimeEqual(hexToBytes('00ff'), hexToBytes('00ff'))).toBe(true);
  });
  it('returns false for different content of same length', () => {
    expect(constantTimeEqual(hexToBytes('00ff'), hexToBytes('00fe'))).toBe(false);
  });
  it('returns false for different lengths', () => {
    expect(constantTimeEqual(hexToBytes('00'), hexToBytes('0000'))).toBe(false);
  });
});
