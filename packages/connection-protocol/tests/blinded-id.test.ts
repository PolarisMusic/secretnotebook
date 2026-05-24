import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import {
  computeBlindedRecipientId,
  computeBlindedRecipientIdHex,
  utcDayBucket,
} from '../src/envelope/blinded-id.js';

const FIXED_DATE = new Date('2026-05-20T12:34:56.789Z');
const OTHER_DAY = new Date('2026-05-21T00:00:00.000Z');

function seq(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

describe('utcDayBucket', () => {
  it('returns the YYYY-MM-DD UTC date regardless of the time-of-day', () => {
    expect(utcDayBucket(FIXED_DATE)).toBe('2026-05-20');
    expect(utcDayBucket(new Date('2026-05-20T23:59:59.999Z'))).toBe('2026-05-20');
    expect(utcDayBucket(OTHER_DAY)).toBe('2026-05-21');
  });
});

describe('computeBlindedRecipientId', () => {
  it('returns a 32-byte digest', async () => {
    const id = await computeBlindedRecipientId({
      connectionRoot: seq(0x42),
      recipientPubkey: seq(0x10),
      date: FIXED_DATE,
    });
    expect(id.length).toBe(32);
  });

  it('is deterministic for the same root + recipient + day', async () => {
    const args = { connectionRoot: seq(0x42), recipientPubkey: seq(0x10), date: FIXED_DATE };
    const a = await computeBlindedRecipientId(args);
    const b = await computeBlindedRecipientId(args);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('rotates daily — same root + same recipient, different day → different id', async () => {
    const today = await computeBlindedRecipientId({
      connectionRoot: seq(0x42),
      recipientPubkey: seq(0x10),
      date: FIXED_DATE,
    });
    const tomorrow = await computeBlindedRecipientId({
      connectionRoot: seq(0x42),
      recipientPubkey: seq(0x10),
      date: OTHER_DAY,
    });
    expect(bytesToHex(today)).not.toBe(bytesToHex(tomorrow));
  });

  it('produces different ids for partner A vs partner B on the same day', async () => {
    const a = await computeBlindedRecipientId({
      connectionRoot: seq(0x42),
      recipientPubkey: seq(0x10),
      date: FIXED_DATE,
    });
    const b = await computeBlindedRecipientId({
      connectionRoot: seq(0x42),
      recipientPubkey: seq(0x20),
      date: FIXED_DATE,
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('does not collide across different connections that share a recipient pubkey on the same day', async () => {
    const args = { recipientPubkey: seq(0x10), date: FIXED_DATE };
    const c1 = await computeBlindedRecipientId({ ...args, connectionRoot: seq(0x01) });
    const c2 = await computeBlindedRecipientId({ ...args, connectionRoot: seq(0x02) });
    expect(bytesToHex(c1)).not.toBe(bytesToHex(c2));
  });

  it('rejects a connection root whose length is not 32 bytes', async () => {
    await expect(
      computeBlindedRecipientId({
        connectionRoot: new Uint8Array(16),
        recipientPubkey: seq(0x10),
        date: FIXED_DATE,
      }),
    ).rejects.toThrow(/connectionRoot/);
  });

  it('rejects a recipient pubkey whose length is not 32 bytes', async () => {
    await expect(
      computeBlindedRecipientId({
        connectionRoot: seq(0x42),
        recipientPubkey: new Uint8Array(20),
        date: FIXED_DATE,
      }),
    ).rejects.toThrow(/recipientPubkey/);
  });

  it('hex helper matches the bytesToHex of the raw helper', async () => {
    const args = { connectionRoot: seq(0x42), recipientPubkey: seq(0x10), date: FIXED_DATE };
    const raw = await computeBlindedRecipientId(args);
    expect(await computeBlindedRecipientIdHex(args)).toBe(bytesToHex(raw));
  });
});
