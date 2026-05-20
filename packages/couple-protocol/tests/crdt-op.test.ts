import { describe, expect, it } from '@jest/globals';
import { CrdtOpSchema, deserialiseOp, serialiseOp, type CrdtOp } from '../src/crdt/op.js';

const sampleSavedPostAdd: CrdtOp = {
  v: 1,
  kind: 'saved_post.add',
  id: '11111111-1111-1111-1111-111111111111',
  globalPostId: '22222222-2222-2222-2222-222222222222',
  savedByPubkey: '00'.repeat(32),
  savedForPubkey: '11'.repeat(32),
  createdAt: 1_700_000_000,
};

const sampleLedgerEntryAdd: CrdtOp = {
  v: 1,
  kind: 'ledger_entry.add',
  id: '33333333-3333-3333-3333-333333333333',
  ledgerKind: 'couple_points',
  delta: 10,
  reason: 'prompt-certified',
  refId: '44444444-4444-4444-4444-444444444444',
  createdAt: 1_700_000_100,
};

describe('serialiseOp / deserialiseOp round-trip', () => {
  it('round-trips a saved_post.add op byte-for-byte', () => {
    const bytes = serialiseOp(sampleSavedPostAdd);
    expect(deserialiseOp(bytes)).toEqual(sampleSavedPostAdd);
  });

  it('round-trips a ledger_entry.add op byte-for-byte', () => {
    const bytes = serialiseOp(sampleLedgerEntryAdd);
    expect(deserialiseOp(bytes)).toEqual(sampleLedgerEntryAdd);
  });

  it('accepts refId === null on ledger_entry.add', () => {
    const op: CrdtOp = { ...sampleLedgerEntryAdd, refId: null };
    expect(deserialiseOp(serialiseOp(op))).toEqual(op);
  });
});

describe('CrdtOpSchema rejects malformed ops', () => {
  it('rejects an unknown kind', () => {
    expect(() =>
      CrdtOpSchema.parse({
        v: 1,
        kind: 'something_else',
        id: '11111111-1111-1111-1111-111111111111',
      }),
    ).toThrow();
  });

  it('rejects a non-uuid id on saved_post.add', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleSavedPostAdd, id: 'not-a-uuid' })).toThrow();
  });

  it('rejects a non-32-byte savedByPubkey', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleSavedPostAdd, savedByPubkey: 'ab' })).toThrow();
  });

  it('rejects a non-couple_points ledgerKind', () => {
    expect(() =>
      CrdtOpSchema.parse({ ...sampleLedgerEntryAdd, ledgerKind: 'popularity' }),
    ).toThrow();
  });

  it('rejects a non-integer delta', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleLedgerEntryAdd, delta: 1.5 })).toThrow();
  });

  it('rejects an empty reason', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleLedgerEntryAdd, reason: '' })).toThrow();
  });
});

describe('deserialiseOp rejects garbage', () => {
  it('rejects bytes that are not valid JSON', () => {
    expect(() => deserialiseOp(new TextEncoder().encode('{not json'))).toThrow();
  });

  it('rejects valid JSON that does not match the schema', () => {
    expect(() => deserialiseOp(new TextEncoder().encode('{"v":1}'))).toThrow();
  });
});
