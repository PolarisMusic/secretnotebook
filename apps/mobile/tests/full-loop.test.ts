import { describe, expect, it } from '@jest/globals';
import { base64ToBytes, bytesToHex } from '@secretnotebook/crypto';
import type {
  ReceivedSyncEnvelope,
  RelayDeleteResponse,
  RelayPostResponse,
  SyncEnvelope,
  SyncEnvelopeList,
} from '@secretnotebook/shared-types';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { ApiClient } from '../src/features/api/client';
import { initAndSaveRatchet, loadRatchet } from '../src/features/connection-channel/ratchet-store';
import { listSavedByMe } from '../src/features/connection-channel/saved-post-store';
import { SyncEngine } from '../src/features/connection-channel/sync-engine';
import { sumConnectionPoints } from '../src/features/ledger/store';
import {
  getNote,
  listNotes,
  publishNote,
  revealSecretNote,
  writeSecretNote,
  writeSharedNote,
  type NoteStoreDeps,
  type PublishToGlobalFeed,
} from '../src/features/notes/store';
import {
  getConnectionRoles,
  setMyRole,
  type RoleStoreDeps,
} from '../src/features/connection/role-store';
import { nodeExecutor } from './helpers/sqlite-executor';

const ROOT_KEY = new Uint8Array(32).fill(0xab);
const CONNECTION_ID = '11111111-1111-1111-1111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);
const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');

interface Stored {
  id: string;
  blindedId: string;
  envelope: SyncEnvelope;
}

class FakeRelay {
  rows: Stored[] = [];
  private seq = 0;
  apiFor(): Pick<ApiClient, 'postEnvelope' | 'listEnvelopes' | 'deleteEnvelope'> {
    return {
      postEnvelope: async (
        blindedId: string,
        envelope: SyncEnvelope,
      ): Promise<RelayPostResponse> => {
        this.seq += 1;
        const id = `00000000-0000-0000-0000-${String(this.seq).padStart(12, '0')}`;
        this.rows.push({ id, blindedId, envelope });
        return {
          id,
          receivedAt: FIXED_NOW.toISOString(),
          expiresAt: new Date(FIXED_NOW.getTime() + 30 * 86_400_000).toISOString(),
        };
      },
      listEnvelopes: async (blindedId: string): Promise<SyncEnvelopeList> => {
        const items: ReceivedSyncEnvelope[] = this.rows
          .filter((r) => r.blindedId === blindedId)
          .map((r) => ({
            ...r.envelope,
            id: r.id,
            receivedAt: FIXED_NOW.toISOString(),
          }));
        return { items, nextCursor: null };
      },
      deleteEnvelope: async (
        blindedId: string,
        envelopeId: string,
      ): Promise<RelayDeleteResponse> => {
        const idx = this.rows.findIndex((r) => r.blindedId === blindedId && r.id === envelopeId);
        if (idx !== -1) this.rows.splice(idx, 1);
        return { ok: true as const };
      },
    };
  }
}

interface Side {
  exec: ReturnType<typeof nodeExecutor>;
  engine: SyncEngine;
}

async function freshSide(args: {
  relay: FakeRelay;
  selfPub: Uint8Array;
  peerPub: Uint8Array;
}): Promise<Side> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  await exec.execute(
    `INSERT INTO connection (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [CONNECTION_ID, A_PUB, B_PUB, ROOT_KEY, 1_700_000_000, 'paired'],
  );
  await initAndSaveRatchet(exec, {
    connectionId: CONNECTION_ID,
    rootKey: ROOT_KEY,
    selfPub: args.selfPub,
    peerPub: args.peerPub,
  });
  const engine = new SyncEngine({
    exec,
    api: args.relay.apiFor() as unknown as ApiClient,
    connectionId: CONNECTION_ID,
    connectionRoot: ROOT_KEY,
    selfPub: args.selfPub,
    peerPub: args.peerPub,
    side: bytesToHex(args.selfPub) < bytesToHex(args.peerPub) ? 'a' : 'b',
    now: () => FIXED_NOW,
  });
  return { exec, engine };
}

async function syncBoth(a: Side, b: Side): Promise<void> {
  await a.engine.flush();
  await b.engine.flush();
  await a.engine.pull();
  await b.engine.pull();
}

function noteDeps(side: Side, selfPub: Uint8Array): NoteStoreDeps {
  return {
    exec: side.exec,
    selfPubkey: selfPub,
    now: () => FIXED_NOW,
    enqueue: (op) => side.engine.enqueue(op),
  };
}

function roleDeps(side: Side, selfPub: Uint8Array): RoleStoreDeps {
  return {
    exec: side.exec,
    selfPubkey: selfPub,
    now: () => FIXED_NOW,
    enqueue: (op) => side.engine.enqueue(op),
  };
}

interface RawOutboxEnvelope {
  envelope: string;
}

async function outboxPlaintext(side: Side): Promise<string> {
  const rows = await side.exec.query<RawOutboxEnvelope>(
    `SELECT envelope FROM sync_outbox ORDER BY id ASC`,
  );
  return rows.map((r) => r.envelope).join('\n');
}

function relayCiphertextBlob(relay: FakeRelay): Uint8Array {
  // Concatenate header + ciphertext bytes across every envelope so a
  // single .includes() check can rule the marker out of the whole
  // current wire image.
  const chunks: Uint8Array[] = [];
  for (const r of relay.rows) {
    chunks.push(base64ToBytes(r.envelope.header));
    chunks.push(base64ToBytes(r.envelope.ciphertext));
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function bytesInclude(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Phase-1.5 R0.5 acceptance harness — the minimal integration backbone
 * the rest of the refactor builds on. The pre-S9 harness drove the
 * full save → assign → certify → unlock → rate → gratitude → +37 loop;
 * everything past "two paired devices that can sync" was deleted in
 * R0 and gets layered back in by:
 *
 *   R2 — shared-note round-trip, secret-note announce + reveal,
 *        and the secret-body-never-on-wire invariant
 *   R3 — publish-from-note → server post → delete
 *   R5 — IAP-gated publish + receipt-validation harness
 *
 * The harness here just asserts the empty starting position: both
 * sides migrate, persist a connection row, init their ratchet, build a
 * SyncEngine, and report zero rows everywhere + zero envelopes on
 * the wire after a no-op sync cycle. If any future change to the
 * boot pipeline breaks this floor, CI catches it before R2 even
 * tries to write a note.
 */
describe('Phase-1.5 acceptance harness — empty-state floor', () => {
  it('two devices migrate, persist a paired connection + ratchet, and start clean', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    // Both ratchets land healthy with the correct side assignment
    // (lexicographic order on pubkey hex determines a/b).
    const aRatchet = await loadRatchet(a.exec, CONNECTION_ID);
    const bRatchet = await loadRatchet(b.exec, CONNECTION_ID);
    expect(aRatchet?.side).toBe('a');
    expect(bRatchet?.side).toBe('b');

    // Data tables empty on both sides.
    expect(await listSavedByMe(a.exec, A_PUB)).toEqual([]);
    expect(await listSavedByMe(b.exec, B_PUB)).toEqual([]);
    expect(await sumConnectionPoints(a.exec)).toBe(0);
    expect(await sumConnectionPoints(b.exec)).toBe(0);
  });

  it('a no-op sync cycle puts nothing on the wire and pulls nothing back', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await syncBoth(a, b);

    // Relay never saw an envelope (nothing to flush, no spurious posts).
    expect(relay.rows).toEqual([]);

    // Data tables are still empty (pull didn't materialise anything).
    expect(await listSavedByMe(a.exec, A_PUB)).toEqual([]);
    expect(await listSavedByMe(b.exec, B_PUB)).toEqual([]);
    expect(await sumConnectionPoints(a.exec)).toBe(0);
    expect(await sumConnectionPoints(b.exec)).toBe(0);

    // Second cycle is also a no-op — guards against an
    // accidental-keepalive regression where the engine pings the
    // relay on every cycle for no reason.
    await syncBoth(a, b);
    expect(relay.rows).toEqual([]);
  });
});

/**
 * R2 layers the notes model on top of the empty-state floor:
 *   - shared notes round-trip body across the connection
 *   - secret notes split announce + reveal so the body stays off
 *     the wire until the author chooses to publish it
 *   - the invariant test makes the second guarantee mechanical,
 *     not "trust the schema"
 */
describe('Phase-1.5 R2 — notes round-trip', () => {
  it('A writes a shared note; after one sync cycle B sees the body', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    const written = await writeSharedNote(noteDeps(a, A_PUB), 'hello from A');
    // Locally A has it immediately.
    expect((await getNote(a.exec, written.id))?.body).toBe('hello from A');
    // B doesn't yet — sync hasn't run.
    expect(await getNote(b.exec, written.id)).toBeNull();

    await syncBoth(a, b);

    const onB = await getNote(b.exec, written.id);
    expect(onB).not.toBeNull();
    expect(onB?.kind).toBe('shared');
    expect(onB?.body).toBe('hello from A');
    expect(bytesToHex(onB!.authorPubkey)).toBe(bytesToHex(A_PUB));
  });

  it('A announces a secret; B sees the row with body=NULL; A reveals; B then sees the body', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    const written = await writeSecretNote(noteDeps(a, A_PUB), 'private thoughts');
    expect((await getNote(a.exec, written.id))?.body).toBe('private thoughts');

    await syncBoth(a, b);

    const announced = await getNote(b.exec, written.id);
    expect(announced).not.toBeNull();
    expect(announced?.kind).toBe('secret');
    expect(announced?.body).toBeNull(); // partner sees existence, not substance
    expect(announced?.revealedAt).toBeNull();
    expect(bytesToHex(announced!.authorPubkey)).toBe(bytesToHex(A_PUB));

    await revealSecretNote(noteDeps(a, A_PUB), written.id);
    await syncBoth(a, b);

    const revealed = await getNote(b.exec, written.id);
    expect(revealed?.body).toBe('private thoughts');
    expect(revealed?.revealedAt).not.toBeNull();
  });

  it('secret bodies never appear on the wire before reveal — protocol- and byte-level checks', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    const MARKER = 'SECRET_BODY_MARKER_xyzzy_42';
    const MARKER_BYTES = new TextEncoder().encode(MARKER);
    const written = await writeSecretNote(noteDeps(a, A_PUB), MARKER);

    // Protocol-level: the outbox row carries the announce op as
    // plaintext JSON. The marker must not be there.
    const preFlushOutbox = await outboxPlaintext(a);
    expect(preFlushOutbox).toContain(written.id); // sanity: the op IS there
    expect(preFlushOutbox).not.toContain(MARKER);

    await a.engine.flush();

    // Byte-level: the relay has the encrypted envelope. The marker
    // bytes must not appear anywhere in header || ciphertext.
    expect(relay.rows).toHaveLength(1);
    expect(bytesInclude(relayCiphertextBlob(relay), MARKER_BYTES)).toBe(false);

    await b.engine.pull();
    // B has the announce — no body yet.
    expect((await getNote(b.exec, written.id))?.body).toBeNull();

    // Reveal: now the body legitimately rides the next op. Sanity-
    // check that it DOES appear in the outbox plaintext after the
    // reveal call so we know the negative checks above weren't just
    // missing it for some other reason.
    await revealSecretNote(noteDeps(a, A_PUB), written.id);
    const postRevealOutbox = await outboxPlaintext(a);
    expect(postRevealOutbox).toContain(MARKER);

    await syncBoth(a, b);
    expect((await getNote(b.exec, written.id))?.body).toBe(MARKER);
  });

  it('a replayed reveal op is a no-op (does not overwrite already-revealed body)', async () => {
    // Idempotency cover: if the same reveal op gets applied twice
    // (e.g. envelope re-delivered for any reason), the projector
    // WHERE clause filters it out and the body + revealed_at stay
    // pinned to the first reveal.
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    const written = await writeSecretNote(noteDeps(a, A_PUB), 'first body');
    await syncBoth(a, b);
    await revealSecretNote(noteDeps(a, A_PUB), written.id);
    await syncBoth(a, b);

    const beforeReplay = await getNote(b.exec, written.id);
    expect(beforeReplay?.body).toBe('first body');
    const firstRevealedAt = beforeReplay?.revealedAt;
    expect(firstRevealedAt).not.toBeNull();

    // Re-apply the projector directly with a tampered body to prove
    // the WHERE-clause guard holds even against a hostile op (i.e.
    // the receiver's invariant doesn't depend on the sender behaving).
    const { applyCrdtOp } = await import('../src/features/connection-channel/projector');
    await applyCrdtOp(b.exec, {
      v: 1,
      kind: 'note.secret.reveal',
      id: written.id,
      body: 'tampered body',
      revealedAt: 1_900_000_000,
    });

    const afterReplay = await getNote(b.exec, written.id);
    expect(afterReplay?.body).toBe('first body'); // unchanged
    expect(afterReplay?.revealedAt).toBe(firstRevealedAt);
  });

  it('listNotes on B reflects both kinds after a round-trip', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await writeSharedNote(noteDeps(a, A_PUB), 'shared from A');
    await writeSecretNote(noteDeps(a, A_PUB), 'secret from A');
    await syncBoth(a, b);

    const onB = await listNotes(b.exec);
    expect(onB).toHaveLength(2);
    const kinds = onB.map((n) => n.kind).sort();
    expect(kinds).toEqual(['secret', 'shared']);
  });
});

/**
 * R3 layers the publish flow on top of R2's notes carrier:
 *   - publishNote calls a server-shaped capability, stamps the
 *     local row's published_*, and emits a note.publish CRDT op
 *   - the partner's projector mirrors the stamping on apply
 *   - server failures roll back cleanly; published rows are
 *     stable against hostile re-publish ops
 */
describe('Phase-1.5 R3 — publish-from-note', () => {
  const PUBLIC_POST_ID = 'cafecafe-cafe-4afe-8afe-cafecafecafe';

  function fakePublish(id = PUBLIC_POST_ID): PublishToGlobalFeed {
    return async () => ({ id });
  }

  it('A publishes a shared note; after one sync B sees published_* mirrored', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    const note = await writeSharedNote(noteDeps(a, A_PUB), 'going public from A');
    await syncBoth(a, b); // B receives the share

    const result = await publishNote(noteDeps(a, A_PUB), note.id, fakePublish());
    expect(result.globalPostId).toBe(PUBLIC_POST_ID);

    // A's local row stamped immediately.
    const onA = await getNote(a.exec, note.id);
    expect(onA?.publishedGlobalPostId).toBe(PUBLIC_POST_ID);
    expect(onA?.publishedAt).toBe(Math.floor(FIXED_NOW.getTime() / 1000));

    // B doesn't know until sync.
    expect((await getNote(b.exec, note.id))?.publishedGlobalPostId).toBeNull();

    await syncBoth(a, b);
    const onB = await getNote(b.exec, note.id);
    expect(onB?.publishedGlobalPostId).toBe(PUBLIC_POST_ID);
    expect(onB?.publishedAt).toBe(onA?.publishedAt);
  });

  it('A publishes a secret note after reveal; the body goes both to the relay (reveal op) and to the server (publish call)', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    const note = await writeSecretNote(noteDeps(a, A_PUB), 'thoughts to publish');
    await syncBoth(a, b); // B sees announce, body still NULL
    await revealSecretNote(noteDeps(a, A_PUB), note.id);
    await syncBoth(a, b); // B now has body

    let sentBody: string | null = null;
    const publish: PublishToGlobalFeed = async (input) => {
      sentBody = input.body;
      return { id: PUBLIC_POST_ID };
    };
    await publishNote(noteDeps(a, A_PUB), note.id, publish);
    expect(sentBody).toBe('thoughts to publish');

    await syncBoth(a, b);
    const onB = await getNote(b.exec, note.id);
    expect(onB?.body).toBe('thoughts to publish');
    expect(onB?.publishedGlobalPostId).toBe(PUBLIC_POST_ID);
  });

  it("when the server POST fails, neither A's row nor B's row gets the published marker", async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    const note = await writeSharedNote(noteDeps(a, A_PUB), 'doomed to fail');
    await syncBoth(a, b);

    const publishBoom: PublishToGlobalFeed = async () => {
      throw new Error('relay 503');
    };
    await expect(publishNote(noteDeps(a, A_PUB), note.id, publishBoom)).rejects.toThrow(
      /relay 503/,
    );

    await syncBoth(a, b);
    expect((await getNote(a.exec, note.id))?.publishedAt).toBeNull();
    expect((await getNote(b.exec, note.id))?.publishedAt).toBeNull();
  });

  it("a replayed publish op cannot overwrite an already-published row (B's pinned values survive)", async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    const note = await writeSharedNote(noteDeps(a, A_PUB), 'first-publish wins');
    await syncBoth(a, b);
    await publishNote(noteDeps(a, A_PUB), note.id, fakePublish());
    await syncBoth(a, b);

    const before = await getNote(b.exec, note.id);
    expect(before?.publishedGlobalPostId).toBe(PUBLIC_POST_ID);

    const { applyCrdtOp } = await import('../src/features/connection-channel/projector');
    await applyCrdtOp(b.exec, {
      v: 1,
      kind: 'note.publish',
      id: note.id,
      publishedGlobalPostId: 'deadbeef-dead-4eef-8eef-deadbeefdead',
      publishedAt: 1_900_000_000,
    });

    const after = await getNote(b.exec, note.id);
    expect(after?.publishedGlobalPostId).toBe(PUBLIC_POST_ID); // pinned
    expect(after?.publishedAt).toBe(before?.publishedAt); // pinned
  });
});

/**
 * R4 layers connection roles on top of R3:
 *   - each partner self-declares (masculine / feminine / neutral)
 *   - their value rounds through the ratchet to the other side
 *   - both sides converge on the same { partnerARole, partnerBRole }
 *   - last-write-wins by ratchet order; hostile ops with non-
 *     matching pubkeys touch nothing
 */
describe('Phase-1.5 R4 — connection roles', () => {
  it('A sets a role; B sees it on the partner_a side after one sync', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await setMyRole(roleDeps(a, A_PUB), 'masculine');

    const onAImmediately = await getConnectionRoles(a.exec);
    expect(onAImmediately?.partnerARole).toBe('masculine');
    expect((await getConnectionRoles(b.exec))?.partnerARole).toBeNull();

    await syncBoth(a, b);

    const onB = await getConnectionRoles(b.exec);
    expect(onB?.partnerARole).toBe('masculine');
    expect(onB?.partnerBRole).toBeNull();
  });

  it('both partners set their roles; both sides converge on the same snapshot', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await setMyRole(roleDeps(a, A_PUB), 'masculine');
    await setMyRole(roleDeps(b, B_PUB), 'feminine');
    await syncBoth(a, b);

    const onA = await getConnectionRoles(a.exec);
    const onB = await getConnectionRoles(b.exec);
    expect(onA).toEqual(onB);
    expect(onA?.partnerARole).toBe('masculine');
    expect(onA?.partnerBRole).toBe('feminine');
  });

  it('a setter can change their mind; the partner converges on the latest value', async () => {
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });

    await setMyRole(roleDeps(a, A_PUB), 'masculine');
    await syncBoth(a, b);
    expect((await getConnectionRoles(b.exec))?.partnerARole).toBe('masculine');

    await setMyRole(roleDeps(a, A_PUB), 'neutral');
    await syncBoth(a, b);
    expect((await getConnectionRoles(b.exec))?.partnerARole).toBe('neutral');
    expect((await getConnectionRoles(a.exec))?.partnerARole).toBe('neutral');
  });

  it('a hostile role.set with a non-matching setterPubkey touches nothing', async () => {
    // Apply the op directly through the projector — bypassing the
    // store guards — to confirm the WHERE pubkey clause is what
    // actually keeps a stranger's role off this connection's row.
    const relay = new FakeRelay();
    const a = await freshSide({ relay, selfPub: A_PUB, peerPub: B_PUB });
    const _b = await freshSide({ relay, selfPub: B_PUB, peerPub: A_PUB });
    void _b;

    await setMyRole(roleDeps(a, A_PUB), 'masculine');
    const before = await getConnectionRoles(a.exec);

    const { applyCrdtOp } = await import('../src/features/connection-channel/projector');
    await applyCrdtOp(a.exec, {
      v: 1,
      kind: 'connection.role.set',
      setterPubkey: 'ee'.repeat(32), // stranger
      role: 'feminine',
      setAt: 1_900_000_000,
    });

    const after = await getConnectionRoles(a.exec);
    expect(after).toEqual(before); // unchanged
  });
});
