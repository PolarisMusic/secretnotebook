import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import {
  compareBytes,
  deriveConnectionSide,
  deserialiseSkippedKeys,
  initRatchetForConnectionSide,
  MAX_SKIPPED_MESSAGE_KEYS,
  ratchetDecrypt,
  ratchetEncrypt,
  restoreRatchetState,
  serialiseSkippedKeys,
  snapshotRatchetState,
} from '../src/ratchet/index.js';

function fixedRoot(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

describe('compareBytes', () => {
  it('returns -1 when the first differing byte of a is smaller', () => {
    expect(compareBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 3, 0]))).toBe(-1);
  });
  it('returns +1 when the first differing byte of a is larger', () => {
    expect(compareBytes(new Uint8Array([2, 0]), new Uint8Array([1, 0xff]))).toBe(1);
  });
  it('returns 0 only on equal-length, byte-equal arrays', () => {
    expect(compareBytes(new Uint8Array([7]), new Uint8Array([7]))).toBe(0);
  });
  it('treats a shorter common-prefix array as smaller', () => {
    expect(compareBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(-1);
    expect(compareBytes(new Uint8Array([1, 2, 0]), new Uint8Array([1, 2]))).toBe(1);
  });
});

describe('deriveConnectionSide', () => {
  it("assigns 'a' to the lexicographically smaller pubkey", () => {
    const small = new Uint8Array(32).fill(0x10);
    const large = new Uint8Array(32).fill(0x20);
    expect(deriveConnectionSide({ selfPub: small, peerPub: large })).toBe('a');
    expect(deriveConnectionSide({ selfPub: large, peerPub: small })).toBe('b');
  });
  it('both partners agree without an extra exchange', () => {
    const a = new Uint8Array(32);
    a[0] = 0x01;
    const b = new Uint8Array(32);
    b[0] = 0x02;
    const sideForA = deriveConnectionSide({ selfPub: a, peerPub: b });
    const sideForB = deriveConnectionSide({ selfPub: b, peerPub: a });
    expect([sideForA, sideForB].sort()).toEqual(['a', 'b']);
  });
  it('throws when the two pubkeys are equal — pairing should have caught this', () => {
    const same = new Uint8Array(32).fill(0x42);
    expect(() => deriveConnectionSide({ selfPub: same, peerPub: same })).toThrow(/equal/);
  });
});

describe('skipped-key codec', () => {
  it('serialises an empty cache to a 3-byte header (version + count=0)', () => {
    const bytes = serialiseSkippedKeys(new Map());
    expect(bytes).toEqual(new Uint8Array([1, 0, 0]));
    expect(deserialiseSkippedKeys(bytes).size).toBe(0);
  });

  it('round-trips a populated cache, preserving counter → key associations', () => {
    const m = new Map<number, Uint8Array>();
    m.set(0, new Uint8Array(32).fill(0xaa));
    m.set(42, new Uint8Array(32).fill(0xbb));
    m.set(0xff_ff_ff_ff, new Uint8Array(32).fill(0xcc));
    const bytes = serialiseSkippedKeys(m);
    const restored = deserialiseSkippedKeys(bytes);
    expect(restored.size).toBe(3);
    expect(bytesToHex(restored.get(0)!)).toBe(bytesToHex(m.get(0)!));
    expect(bytesToHex(restored.get(42)!)).toBe(bytesToHex(m.get(42)!));
    expect(bytesToHex(restored.get(0xff_ff_ff_ff)!)).toBe(bytesToHex(m.get(0xff_ff_ff_ff)!));
  });

  it('produces a deterministic byte layout regardless of insertion order', () => {
    const m1 = new Map<number, Uint8Array>();
    m1.set(7, new Uint8Array(32).fill(0x07));
    m1.set(1, new Uint8Array(32).fill(0x01));
    const m2 = new Map<number, Uint8Array>();
    m2.set(1, new Uint8Array(32).fill(0x01));
    m2.set(7, new Uint8Array(32).fill(0x07));
    expect(bytesToHex(serialiseSkippedKeys(m1))).toBe(bytesToHex(serialiseSkippedKeys(m2)));
  });

  it('rejects a cache larger than the protocol limit', () => {
    const oversized = new Map<number, Uint8Array>();
    for (let i = 0; i <= MAX_SKIPPED_MESSAGE_KEYS; i++) {
      oversized.set(i, new Uint8Array(32));
    }
    expect(() => serialiseSkippedKeys(oversized)).toThrow(/limit/);
  });

  it('rejects a serialised blob whose declared count does not match length', () => {
    const m = new Map<number, Uint8Array>([[1, new Uint8Array(32).fill(0xab)]]);
    const bytes = new Uint8Array(serialiseSkippedKeys(m));
    expect(() => deserialiseSkippedKeys(bytes.slice(0, bytes.length - 1))).toThrow(/expected/);
  });

  it('rejects an unknown version byte', () => {
    const bad = new Uint8Array([0xff, 0, 0]);
    expect(() => deserialiseSkippedKeys(bad)).toThrow(/unsupported version/);
  });

  it('rejects too-short input', () => {
    expect(() => deserialiseSkippedKeys(new Uint8Array(2))).toThrow(/too short/);
  });

  it('rejects a key field whose length is not 32 bytes', () => {
    const m = new Map<number, Uint8Array>([[0, new Uint8Array(16)]]);
    expect(() => serialiseSkippedKeys(m)).toThrow(/32 bytes/);
  });
});

describe('snapshotRatchetState + restoreRatchetState', () => {
  it('round-trips a freshly initialised state', async () => {
    const state = await initRatchetForConnectionSide(fixedRoot(0x11), 'a');
    const snap = snapshotRatchetState(state);
    const restored = restoreRatchetState(snap);
    expect(bytesToHex(restored.sendingChainKey)).toBe(bytesToHex(state.sendingChainKey));
    expect(bytesToHex(restored.receivingChainKey)).toBe(bytesToHex(state.receivingChainKey));
    expect(restored.sendingCounter).toBe(state.sendingCounter);
    expect(restored.receivingCounter).toBe(state.receivingCounter);
    expect(restored.skipped.size).toBe(0);
  });

  it('round-trips after several encrypts + an out-of-order decrypt populates skipped', async () => {
    const root = fixedRoot(0x22);
    const a = await initRatchetForConnectionSide(root, 'a');
    const b = await initRatchetForConnectionSide(root, 'b');

    const env0 = await ratchetEncrypt(a, new TextEncoder().encode('0'));
    const env1 = await ratchetEncrypt(a, new TextEncoder().encode('1'));
    const env2 = await ratchetEncrypt(a, new TextEncoder().encode('2'));
    // B receives 2 first → 0 and 1 stashed
    await ratchetDecrypt(b, env2.header, env2.ciphertext);
    expect(b.skipped.size).toBe(2);

    // Persist + restore B. The restored ratchet must consume env0 + env1
    // even though B's in-memory state is gone.
    const restored = restoreRatchetState(snapshotRatchetState(b));
    expect(restored.skipped.size).toBe(2);
    const got0 = await ratchetDecrypt(restored, env0.header, env0.ciphertext);
    expect(new TextDecoder().decode(got0)).toBe('0');
    const got1 = await ratchetDecrypt(restored, env1.header, env1.ciphertext);
    expect(new TextDecoder().decode(got1)).toBe('1');
    expect(restored.skipped.size).toBe(0);
  });

  it('rejects a snapshot with a chain key of the wrong length', () => {
    const badSnap = {
      sendingChainKey: new Uint8Array(16),
      sendingCounter: 0,
      receivingChainKey: new Uint8Array(32),
      receivingCounter: 0,
      skippedKeysBlob: new Uint8Array([1, 0, 0]),
    };
    expect(() => restoreRatchetState(badSnap)).toThrow(/sendingChainKey/);
  });

  it('rejects a snapshot whose counter is out of uint32 range', () => {
    const badSnap = {
      sendingChainKey: new Uint8Array(32),
      sendingCounter: 0x1_00_00_00_00,
      receivingChainKey: new Uint8Array(32),
      receivingCounter: 0,
      skippedKeysBlob: new Uint8Array([1, 0, 0]),
    };
    expect(() => restoreRatchetState(badSnap)).toThrow(/sendingCounter/);
  });
});
