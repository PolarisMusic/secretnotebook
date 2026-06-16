import { describe, expect, it } from '@jest/globals';
import {
  ATTACHMENT_MAX_BYTES,
  CrdtOpSchema,
  deserialiseOp,
  serialiseOp,
  type AttachmentDescriptor,
  type CrdtOp,
} from '../src/crdt/op.js';

const sampleSavedPostAdd: CrdtOp = {
  v: 1,
  kind: 'saved_post.add',
  id: '11111111-1111-1111-1111-111111111111',
  globalPostId: '22222222-2222-2222-2222-222222222222',
  savedByPubkey: '00'.repeat(32),
  savedForPubkey: '11'.repeat(32),
  createdAt: 1_700_000_000,
};

/**
 * Revived in R7 — carries Couple-Points awards for the unlock loop.
 * Must round-trip cleanly (a stale pre-R7 envelope still parses too).
 * The projector applies it as INSERT OR IGNORE; see projector tests.
 */
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

const sampleNotePublish: CrdtOp = {
  v: 1,
  kind: 'note.publish',
  id: '77777777-7777-7777-7777-777777777777',
  publishedGlobalPostId: '88888888-8888-8888-8888-888888888888',
  publishedAt: 1_700_000_500,
};

const sampleAttachment: AttachmentDescriptor = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  blobId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  mediaType: 'image',
  mimeType: 'image/jpeg',
  byteSize: 2048,
  contentHash: 'cd'.repeat(32),
  contentKey: 'ef'.repeat(32),
  noncePrefix: 'ab'.repeat(16),
  chunkSize: 65536,
  width: 800,
  height: 600,
};

const sampleNoteShareAddWithMedia: CrdtOp = {
  v: 1,
  kind: 'note.share.add',
  id: 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  authorPubkey: '22'.repeat(32),
  body: 'look at this',
  attachments: [sampleAttachment],
  createdAt: 1_700_000_210,
};

const sampleNoteShareAddMediaOnly: CrdtOp = {
  v: 1,
  kind: 'note.share.add',
  id: 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2',
  authorPubkey: '22'.repeat(32),
  attachments: [
    { ...sampleAttachment, mediaType: 'audio', mimeType: 'audio/m4a', durationMs: 4200 },
  ],
  createdAt: 1_700_000_211,
};

const sampleNoteSecretRevealWithMedia: CrdtOp = {
  v: 1,
  kind: 'note.secret.reveal',
  id: '66666666-6666-6666-6666-666666666666',
  body: 'the photo I was holding back',
  attachments: [sampleAttachment],
  revealedAt: 1_700_000_410,
};

const sampleConnectionRoleSet: CrdtOp = {
  v: 1,
  kind: 'connection.role.set',
  setterPubkey: '44'.repeat(32),
  role: 'masculine',
  setAt: 1_700_000_600,
};

const sampleSafeWordPropose: CrdtOp = {
  v: 1,
  kind: 'connection.safeword.propose',
  proposerPubkey: '55'.repeat(32),
  verifier: 'ab'.repeat(32),
  proposedAt: 1_700_000_700,
};

const sampleSafeWordConfirm: CrdtOp = {
  v: 1,
  kind: 'connection.safeword.confirm',
  confirmerPubkey: '66'.repeat(32),
  confirmedAt: 1_700_000_800,
};

const sampleSafeWordTrigger: CrdtOp = {
  v: 1,
  kind: 'connection.safeword.trigger',
  id: '99999999-9999-9999-9999-999999999999',
  triggeredByPubkey: '77'.repeat(32),
  triggeredAt: 1_700_000_900,
};

const sampleSafeWordAck: CrdtOp = {
  v: 1,
  kind: 'connection.safeword.ack',
  id: '99999999-9999-9999-9999-999999999999',
  ackedByPubkey: '88'.repeat(32),
  ackedAt: 1_700_001_000,
};

const ATTEMPT_ID = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const REVEALED_NOTE_ID = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';

const sampleUnlockStart: CrdtOp = {
  v: 1,
  kind: 'secret_unlock.start',
  id: ATTEMPT_ID,
  authorPubkey: '11'.repeat(32),
  unlockerPubkey: '22'.repeat(32),
  promptKey: 'pq_unhurried_walk',
  createdAt: 1_700_002_000,
};

const sampleUnlockSubmit: CrdtOp = {
  v: 1,
  kind: 'secret_unlock.submit',
  attemptId: ATTEMPT_ID,
  unlockerPubkey: '22'.repeat(32),
  submittedAt: 1_700_002_100,
};

const sampleUnlockReject: CrdtOp = {
  v: 1,
  kind: 'secret_unlock.reject',
  attemptId: ATTEMPT_ID,
  authorPubkey: '11'.repeat(32),
  rejectedAt: 1_700_002_150,
};

const sampleUnlockVerify: CrdtOp = {
  v: 1,
  kind: 'secret_unlock.verify',
  attemptId: ATTEMPT_ID,
  authorPubkey: '11'.repeat(32),
  revealedNoteId: REVEALED_NOTE_ID,
  body: 'the secret you earned',
  verifiedAt: 1_700_002_200,
};

const sampleUnlockVerifyWithMedia: CrdtOp = {
  v: 1,
  kind: 'secret_unlock.verify',
  attemptId: ATTEMPT_ID,
  authorPubkey: '11'.repeat(32),
  revealedNoteId: REVEALED_NOTE_ID,
  body: 'the secret photo',
  attachments: [sampleAttachment],
  verifiedAt: 1_700_002_201,
};

const sampleUnlockCancel: CrdtOp = {
  v: 1,
  kind: 'secret_unlock.cancel',
  attemptId: ATTEMPT_ID,
  unlockerPubkey: '22'.repeat(32),
  canceledAt: 1_700_002_300,
};

const sampleUnlockReflect: CrdtOp = {
  v: 1,
  kind: 'secret_unlock.reflect',
  attemptId: ATTEMPT_ID,
  byPubkey: '22'.repeat(32),
  appreciate: 'I loved that you trusted me with this.',
  uncomfortable: 'Nothing — it felt safe.',
  stars: 5,
  reflectedAt: 1_700_002_400,
};

const sampleUnlockReflectNoStars: CrdtOp = {
  v: 1,
  kind: 'secret_unlock.reflect',
  attemptId: ATTEMPT_ID,
  byPubkey: '11'.repeat(32),
  appreciate: 'Thank you for doing the prompt.',
  uncomfortable: 'A little vulnerable, but good.',
  reflectedAt: 1_700_002_401,
};

describe('serialiseOp / deserialiseOp round-trip', () => {
  it('round-trips a saved_post.add op byte-for-byte', () => {
    const bytes = serialiseOp(sampleSavedPostAdd);
    expect(deserialiseOp(bytes)).toEqual(sampleSavedPostAdd);
  });

  it('round-trips the revived ledger_entry.add op byte-for-byte', () => {
    const bytes = serialiseOp(sampleLedgerEntryAdd);
    expect(deserialiseOp(bytes)).toEqual(sampleLedgerEntryAdd);
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

  it('round-trips a note.publish op byte-for-byte', () => {
    expect(deserialiseOp(serialiseOp(sampleNotePublish))).toEqual(sampleNotePublish);
  });

  it('rejects a non-uuid publishedGlobalPostId', () => {
    expect(() =>
      CrdtOpSchema.parse({ ...sampleNotePublish, publishedGlobalPostId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('round-trips a connection.role.set op byte-for-byte', () => {
    expect(deserialiseOp(serialiseOp(sampleConnectionRoleSet))).toEqual(sampleConnectionRoleSet);
  });

  it('rejects a role outside the masculine/feminine/neutral enum', () => {
    expect(() =>
      CrdtOpSchema.parse({ ...sampleConnectionRoleSet, role: 'something-else' }),
    ).toThrow();
  });

  it('rejects a non-32-byte setterPubkey', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleConnectionRoleSet, setterPubkey: 'ab' })).toThrow();
  });

  it('round-trips the four safeword ops byte-for-byte', () => {
    expect(deserialiseOp(serialiseOp(sampleSafeWordPropose))).toEqual(sampleSafeWordPropose);
    expect(deserialiseOp(serialiseOp(sampleSafeWordConfirm))).toEqual(sampleSafeWordConfirm);
    expect(deserialiseOp(serialiseOp(sampleSafeWordTrigger))).toEqual(sampleSafeWordTrigger);
    expect(deserialiseOp(serialiseOp(sampleSafeWordAck))).toEqual(sampleSafeWordAck);
  });

  it('rejects a non-32-byte verifier on safeword.propose', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleSafeWordPropose, verifier: 'ab' })).toThrow();
  });

  it('rejects a non-32-byte proposerPubkey on safeword.propose', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleSafeWordPropose, proposerPubkey: 'zz' })).toThrow();
  });

  it('rejects a non-uuid id on safeword.trigger', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleSafeWordTrigger, id: 'not-a-uuid' })).toThrow();
  });

  it('rejects a negative ackedAt on safeword.ack', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleSafeWordAck, ackedAt: -1 })).toThrow();
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

  it('refuses an announce op that smuggles attachments', () => {
    expect(() =>
      CrdtOpSchema.parse({ ...sampleNoteSecretAnnounce, attachments: [sampleAttachment] }),
    ).toThrow();
  });
});

describe('note attachments', () => {
  it('round-trips a share.add op carrying media', () => {
    expect(deserialiseOp(serialiseOp(sampleNoteShareAddWithMedia))).toEqual(
      sampleNoteShareAddWithMedia,
    );
  });

  it('round-trips a media-only share.add op (no body key)', () => {
    const bytes = serialiseOp(sampleNoteShareAddMediaOnly);
    expect(new TextDecoder().decode(bytes)).not.toContain('"body"');
    expect(deserialiseOp(bytes)).toEqual(sampleNoteShareAddMediaOnly);
  });

  it('round-trips a secret.reveal op carrying media', () => {
    expect(deserialiseOp(serialiseOp(sampleNoteSecretRevealWithMedia))).toEqual(
      sampleNoteSecretRevealWithMedia,
    );
  });

  it('omits the attachments key entirely when a note has no media', () => {
    expect(new TextDecoder().decode(serialiseOp(sampleNoteShareAdd))).not.toContain('attachments');
  });

  it('rejects more than the per-note attachment cap', () => {
    const tooMany = Array.from({ length: 9 }, () => sampleAttachment);
    expect(() =>
      CrdtOpSchema.parse({ ...sampleNoteShareAddWithMedia, attachments: tooMany }),
    ).toThrow();
  });

  it('rejects an attachment over the byte-size cap', () => {
    expect(() =>
      CrdtOpSchema.parse({
        ...sampleNoteShareAddWithMedia,
        attachments: [{ ...sampleAttachment, byteSize: ATTACHMENT_MAX_BYTES + 1 }],
      }),
    ).toThrow();
  });

  it('rejects an attachment with a malformed content key', () => {
    expect(() =>
      CrdtOpSchema.parse({
        ...sampleNoteShareAddWithMedia,
        attachments: [{ ...sampleAttachment, contentKey: 'ab' }],
      }),
    ).toThrow();
  });

  it('rejects an unknown media type', () => {
    expect(() =>
      CrdtOpSchema.parse({
        ...sampleNoteShareAddWithMedia,
        attachments: [{ ...sampleAttachment, mediaType: 'video' }],
      }),
    ).toThrow();
  });

  it('rejects an attachment with an unexpected extra field (strict)', () => {
    expect(() =>
      CrdtOpSchema.parse({
        ...sampleNoteShareAddWithMedia,
        attachments: [{ ...sampleAttachment, sneaky: 'field' }],
      }),
    ).toThrow();
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

  it('rejects a non-integer delta on a stale ledger_entry.add (schema is still strict)', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleLedgerEntryAdd, delta: 1.5 })).toThrow();
  });
});

const sampleSeverSchedule: CrdtOp = {
  v: 1,
  kind: 'connection.sever.schedule',
  byPubkey: '33'.repeat(32),
  severAt: 1_700_600_000,
};

const sampleSeverCancel: CrdtOp = {
  v: 1,
  kind: 'connection.sever.cancel',
  byPubkey: '33'.repeat(32),
  canceledAt: 1_700_600_100,
};

describe('connection sever ops round-trip', () => {
  it('round-trips schedule + cancel byte-for-byte', () => {
    expect(deserialiseOp(serialiseOp(sampleSeverSchedule))).toEqual(sampleSeverSchedule);
    expect(deserialiseOp(serialiseOp(sampleSeverCancel))).toEqual(sampleSeverCancel);
  });

  it('rejects a non-32-byte byPubkey on schedule', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleSeverSchedule, byPubkey: 'ab' })).toThrow();
  });

  it('rejects an unknown field (strict)', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleSeverSchedule, extra: 1 })).toThrow();
  });
});

describe('secret-unlock ops round-trip', () => {
  it('round-trips start / submit / reject / cancel byte-for-byte', () => {
    expect(deserialiseOp(serialiseOp(sampleUnlockStart))).toEqual(sampleUnlockStart);
    expect(deserialiseOp(serialiseOp(sampleUnlockSubmit))).toEqual(sampleUnlockSubmit);
    expect(deserialiseOp(serialiseOp(sampleUnlockReject))).toEqual(sampleUnlockReject);
    expect(deserialiseOp(serialiseOp(sampleUnlockCancel))).toEqual(sampleUnlockCancel);
  });

  it('round-trips verify with and without media', () => {
    expect(deserialiseOp(serialiseOp(sampleUnlockVerify))).toEqual(sampleUnlockVerify);
    expect(deserialiseOp(serialiseOp(sampleUnlockVerifyWithMedia))).toEqual(
      sampleUnlockVerifyWithMedia,
    );
  });

  it('round-trips reflect; omits the optional stars key when absent', () => {
    expect(deserialiseOp(serialiseOp(sampleUnlockReflect))).toEqual(sampleUnlockReflect);
    const noStars = serialiseOp(sampleUnlockReflectNoStars);
    expect(new TextDecoder().decode(noStars)).not.toContain('stars');
    expect(deserialiseOp(noStars)).toEqual(sampleUnlockReflectNoStars);
  });

  it('rejects stars outside 1–5', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleUnlockReflect, stars: 6 })).toThrow();
    expect(() => CrdtOpSchema.parse({ ...sampleUnlockReflect, stars: 0 })).toThrow();
  });

  it('rejects an empty reflection answer', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleUnlockReflect, appreciate: '' })).toThrow();
  });

  it('rejects a verify op that smuggles an unknown field (strict)', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleUnlockVerify, sneaky: 'x' })).toThrow();
  });

  it('rejects a non-32-byte unlockerPubkey on start', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleUnlockStart, unlockerPubkey: 'ab' })).toThrow();
  });

  it('rejects a non-uuid attemptId on submit', () => {
    expect(() => CrdtOpSchema.parse({ ...sampleUnlockSubmit, attemptId: 'nope' })).toThrow();
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
