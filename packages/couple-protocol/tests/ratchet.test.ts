import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import { decodeHeader, encodeHeader } from '../src/ratchet/header.js';
import {
  initRatchetForCoupleSide,
  ratchetDecrypt,
  ratchetEncrypt,
} from '../src/ratchet/ratchet.js';
import {
  MAX_SKIPPED_MESSAGE_KEYS,
  type EncryptedEnvelope,
  type RatchetState,
} from '../src/ratchet/types.js';

function fixedRoot(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

async function pairedRatchets(): Promise<{ a: RatchetState; b: RatchetState }> {
  const root = fixedRoot(0x42);
  return {
    a: await initRatchetForCoupleSide(root, 'a'),
    b: await initRatchetForCoupleSide(root, 'b'),
  };
}

describe('ratchet header codec', () => {
  it('round-trips version + counter', () => {
    const round = (n: number): number => decodeHeader(encodeHeader(n)).counter;
    expect(round(0)).toBe(0);
    expect(round(1)).toBe(1);
    expect(round(0x1234_5678)).toBe(0x1234_5678);
    expect(round(0xff_ff_ff_ff)).toBe(0xff_ff_ff_ff);
  });

  it('rejects out-of-range counters at encode', () => {
    expect(() => encodeHeader(-1)).toThrow(/out of range/);
    expect(() => encodeHeader(0x1_00_00_00_00)).toThrow(/out of range/);
    expect(() => encodeHeader(1.5)).toThrow(/out of range/);
  });

  it('rejects a header of unexpected length at decode', () => {
    expect(() => decodeHeader(new Uint8Array(4))).toThrow(/expected/);
    expect(() => decodeHeader(new Uint8Array(6))).toThrow(/expected/);
  });

  it('rejects an unknown version byte', () => {
    const bad = new Uint8Array([0xff, 0, 0, 0, 0]);
    expect(() => decodeHeader(bad)).toThrow(/unsupported version/);
  });
});

describe('initRatchetForCoupleSide', () => {
  it('rejects a root key of the wrong length', async () => {
    await expect(initRatchetForCoupleSide(new Uint8Array(16), 'a')).rejects.toThrow(/32 bytes/);
  });

  it('gives the two sides mirrored chains — sending(a) === receiving(b)', async () => {
    const { a, b } = await pairedRatchets();
    expect(bytesToHex(a.sendingChainKey)).toBe(bytesToHex(b.receivingChainKey));
    expect(bytesToHex(a.receivingChainKey)).toBe(bytesToHex(b.sendingChainKey));
  });

  it('derives different chains for the same root if sides match — sanity check on the domain split', async () => {
    const root = fixedRoot(0x42);
    const a1 = await initRatchetForCoupleSide(root, 'a');
    const a2 = await initRatchetForCoupleSide(root, 'a');
    // Same side from same root = same state.
    expect(bytesToHex(a1.sendingChainKey)).toBe(bytesToHex(a2.sendingChainKey));
    expect(bytesToHex(a1.receivingChainKey)).toBe(bytesToHex(a2.receivingChainKey));
    // Sending and receiving must NOT collide (domain separation).
    expect(bytesToHex(a1.sendingChainKey)).not.toBe(bytesToHex(a1.receivingChainKey));
  });
});

describe('ratchet round-trip — single message', () => {
  it('A → B encrypt/decrypt restores the exact plaintext bytes', async () => {
    const { a, b } = await pairedRatchets();
    const plain = new TextEncoder().encode('hello partner');
    const env = await ratchetEncrypt(a, plain);
    const decoded = await ratchetDecrypt(b, env.header, env.ciphertext);
    expect(Array.from(decoded)).toEqual(Array.from(plain));
  });

  it("B → A round-trip works on the other direction's chain", async () => {
    const { a, b } = await pairedRatchets();
    const plain = new TextEncoder().encode('hi from b');
    const env = await ratchetEncrypt(b, plain);
    const decoded = await ratchetDecrypt(a, env.header, env.ciphertext);
    expect(Array.from(decoded)).toEqual(Array.from(plain));
  });

  it('the same input encrypted twice yields different ciphertexts (chain ratchet advances)', async () => {
    const { a } = await pairedRatchets();
    const plain = new TextEncoder().encode('same');
    const e1 = await ratchetEncrypt(a, plain);
    const e2 = await ratchetEncrypt(a, plain);
    expect(bytesToHex(e1.ciphertext)).not.toBe(bytesToHex(e2.ciphertext));
  });
});

describe('ratchet round-trip — many messages in order', () => {
  it('keeps decrypting in lock-step as counters advance', async () => {
    const { a, b } = await pairedRatchets();
    const plaintexts = Array.from({ length: 25 }, (_, i) => new TextEncoder().encode(`msg #${i}`));
    const envelopes: EncryptedEnvelope[] = [];
    for (const p of plaintexts) envelopes.push(await ratchetEncrypt(a, p));
    for (let i = 0; i < envelopes.length; i++) {
      const env = envelopes[i]!;
      const got = await ratchetDecrypt(b, env.header, env.ciphertext);
      expect(new TextDecoder().decode(got)).toBe(`msg #${i}`);
    }
    expect(a.sendingCounter).toBe(25);
    expect(b.receivingCounter).toBe(25);
    expect(b.skipped.size).toBe(0);
  });
});

describe('out-of-order delivery', () => {
  it('caches skipped keys and decrypts a delayed earlier envelope correctly', async () => {
    const { a, b } = await pairedRatchets();
    const e0 = await ratchetEncrypt(a, new TextEncoder().encode('zero'));
    const e1 = await ratchetEncrypt(a, new TextEncoder().encode('one'));
    const e2 = await ratchetEncrypt(a, new TextEncoder().encode('two'));

    // B sees e2 before e0/e1.
    const got2 = await ratchetDecrypt(b, e2.header, e2.ciphertext);
    expect(new TextDecoder().decode(got2)).toBe('two');
    expect(b.skipped.size).toBe(2); // 0 and 1 stashed
    expect(b.receivingCounter).toBe(3);

    const got0 = await ratchetDecrypt(b, e0.header, e0.ciphertext);
    expect(new TextDecoder().decode(got0)).toBe('zero');
    const got1 = await ratchetDecrypt(b, e1.header, e1.ciphertext);
    expect(new TextDecoder().decode(got1)).toBe('one');
    expect(b.skipped.size).toBe(0);
  });

  it('rejects a replay of an already-consumed (in-order) envelope', async () => {
    const { a, b } = await pairedRatchets();
    const env = await ratchetEncrypt(a, new TextEncoder().encode('one shot'));
    await ratchetDecrypt(b, env.header, env.ciphertext);
    await expect(ratchetDecrypt(b, env.header, env.ciphertext)).rejects.toThrow(
      /replayed or already-consumed/,
    );
  });

  it('rejects a replay of an already-consumed (out-of-order) envelope', async () => {
    const { a, b } = await pairedRatchets();
    const e0 = await ratchetEncrypt(a, new TextEncoder().encode('zero'));
    const e1 = await ratchetEncrypt(a, new TextEncoder().encode('one'));
    await ratchetDecrypt(b, e1.header, e1.ciphertext); // stashes 0
    await ratchetDecrypt(b, e0.header, e0.ciphertext); // consumes 0
    await expect(ratchetDecrypt(b, e0.header, e0.ciphertext)).rejects.toThrow(
      /replayed or already-consumed/,
    );
  });

  it('rejects a gap larger than the skipped-key bound', async () => {
    const { a, b } = await pairedRatchets();
    // Advance A past the cap so the eventual envelope has a counter
    // that would create a too-big gap on B.
    const tooFar = MAX_SKIPPED_MESSAGE_KEYS + 10;
    let env: EncryptedEnvelope | null = null;
    for (let i = 0; i < tooFar + 1; i++) {
      env = await ratchetEncrypt(a, new TextEncoder().encode(`#${i}`));
    }
    if (!env) throw new Error('expected an envelope');
    await expect(ratchetDecrypt(b, env.header, env.ciphertext)).rejects.toThrow(/gap/);
  });
});

describe('integrity', () => {
  it('rejects a tampered ciphertext (AEAD tag fails)', async () => {
    const { a, b } = await pairedRatchets();
    const env = await ratchetEncrypt(a, new TextEncoder().encode('payload'));
    const tampered = new Uint8Array(env.ciphertext);
    tampered[0]! ^= 0xff;
    await expect(ratchetDecrypt(b, env.header, tampered)).rejects.toBeTruthy();
  });

  it("rejects a tampered header counter (AAD doesn't match)", async () => {
    const { a, b } = await pairedRatchets();
    const env = await ratchetEncrypt(a, new TextEncoder().encode('payload'));
    // Swap the header to claim a different counter while leaving the
    // ciphertext intact. The decryptor will advance to the wrong
    // message key and AEAD verification will fail.
    const tamperedHeader = new Uint8Array(env.header);
    tamperedHeader[4]! ^= 0x01; // flip the LSB of the counter
    await expect(ratchetDecrypt(b, tamperedHeader, env.ciphertext)).rejects.toBeTruthy();
  });

  it('a third party with a different root cannot decrypt anything (server-cannot-decrypt invariant)', async () => {
    const root = fixedRoot(0x42);
    const a = await initRatchetForCoupleSide(root, 'a');
    const env = await ratchetEncrypt(a, new TextEncoder().encode('top secret'));

    // The relay only sees `(header, ciphertext)` and has no access to
    // the couple root — modelled here by a third ratchet initialised
    // from a different root entirely.
    const wrongRoot = fixedRoot(0xee);
    const eavesdropper = await initRatchetForCoupleSide(wrongRoot, 'b');
    await expect(ratchetDecrypt(eavesdropper, env.header, env.ciphertext)).rejects.toBeTruthy();
  });
});
