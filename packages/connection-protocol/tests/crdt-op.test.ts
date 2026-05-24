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

const sampleNoteShareAdd: CrdtOp = {
  v: 1,
  kind: 'note.share.add',
  id: '55555555-5555-5555-5555-555555555555',
  authorPubkey: '22'.repeat(32),
  body: 'a thought worth sharing',
  createdAt: 1_700_000_200,
};

const sampleNoteSecretAnnounce: CrdtOp = {
  v: 1,
  kind: 'note.secret.announce',
  id: '66666666-6666-6666-6666-666666666666',
  authorPubkey: '33'.repeat(32),
  createdAt: 1_700_000_300,
};

const sampleNoteSecretReveal: CrdtOp = {
  v: 1,
  kind: 'note.secret.reveal',
  id: '66666666-6666-6666-6666-666666666666',
  body: 'what I was holding back',
  revealedAt: 1_700_000_400,
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

  it('round-trips a note.share.add op byte-for-byte', () => {
    expect(deserialiseOp(serialiseOp(sampleNoteShareAdd))).toEqual(sampleNoteShareAdd);
  });

  it('round-trips a note.secret.announce op byte-for-byte', () => {
    expect(deserialiseOp(serialiseOp(sampleNoteSecretAnnounce))).toEqual(sampleNoteSecretAnnounce);
  });

  it('round-trips a note.secret.reveal op byte-for-byte', () => {
    expect(deserialiseOp(serialiseOp(sampleNoteSecretReveal))).toEqual(sampleNoteSecretReveal);
  });
});

describe('note.secret.announce body invariant', () => {
  // The privacy guarantee of the secret-note flow is that announce
  // ops carry no body. Lock that into the schema: any attempt to
  // include a `body` key, even spelt the same way as the reveal op,
  // must be rejected so a future refactor can't silently widen the
  // op and leak the substance.
  it('refuses an announce op that smuggles a body key', () => {
    expect(() =>
      CrdtOpSchema.parse({
        ...sampleNoteSecretAnnounce,
        body: 'should not be here',
      }),
    ).toThrow();
  });

  it('keeps the serialised bytes free of any extra string fields', () => {
    const json = new TextDecoder().decode(serialiseOp(sampleNoteSecretAnnounce));
    expect(json).not.toContain('"body"');
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
