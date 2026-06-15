import { describe, expect, it, jest } from '@jest/globals';
import { deserialiseOp, serialiseOp, type CrdtOp } from '@secretnotebook/connection-protocol';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { applyCrdtOp } from '../src/features/connection-channel/projector';
import { randomUuidV4 } from '../src/features/connection-channel/uuid';
import {
  downloadAttachment,
  openAttachment,
  prepareAttachment,
} from '../src/features/attachments/pipeline';
import {
  getAttachment,
  insertAttachmentFromDescriptor,
  listNoteAttachments,
} from '../src/features/attachments/store';
import type { FileStore, PickedMedia } from '../src/features/attachments/types';
import {
  getNote,
  revealSecretNote,
  writeSecretNote,
  writeSharedNote,
  type NoteStoreDeps,
} from '../src/features/notes/store';
import { nodeExecutor } from './helpers/sqlite-executor';
import type { SqlExecutor } from '../src/db/executor';

const AUTHOR_PUB = new Uint8Array(32).fill(0x33);
const FIXED_NOW = new Date('2026-06-15T08:00:00.000Z');

async function freshExec(): Promise<SqlExecutor> {
  const exec = nodeExecutor(new Database(':memory:'));
  await runMigrations(exec, MIGRATIONS);
  return exec;
}

/** In-memory FileStore standing in for expo-file-system. */
class MemFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();

  async readFile(uri: string): Promise<Uint8Array> {
    const b = this.files.get(uri);
    if (!b) throw new Error(`MemFileStore: no file ${uri}`);
    return b.slice();
  }
  async writeEncryptedFile(name: string, bytes: Uint8Array): Promise<string> {
    const uri = `enc://${name}`;
    this.files.set(uri, bytes.slice());
    return uri;
  }
  async writeCacheFile(name: string, bytes: Uint8Array): Promise<string> {
    const uri = `cache://${name}`;
    this.files.set(uri, bytes.slice());
    return uri;
  }
  async remove(uri: string): Promise<void> {
    this.files.delete(uri);
  }
}

/** In-memory stand-in for the /v1/blobs store. */
function makeBlobServer() {
  const blobs = new Map<string, Uint8Array>();
  const downloadBlob = jest.fn(async (id: string): Promise<Uint8Array> => {
    const b = blobs.get(id);
    if (!b) throw new Error(`blob server: no blob ${id}`);
    return b.slice();
  });
  const uploadBlob = jest.fn(async (ciphertext: Uint8Array): Promise<{ id: string }> => {
    const id = await randomUuidV4();
    blobs.set(id, ciphertext.slice());
    return { id };
  });
  return { blobs, uploadBlob, downloadBlob };
}

function patternBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

function authorDeps(exec: SqlExecutor, enqueued: CrdtOp[]): NoteStoreDeps {
  return {
    exec,
    selfPubkey: AUTHOR_PUB,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op);
    },
  };
}

describe('attachment pipeline', () => {
  it('round-trips bytes: prepare (author) -> remote -> download -> open (partner)', async () => {
    const authorFs = new MemFileStore();
    const partnerFs = new MemFileStore();
    const server = makeBlobServer();
    const plaintext = patternBytes(100_000); // > 64 KiB → multiple chunks
    authorFs.files.set('src://img', plaintext);
    const picked: PickedMedia = {
      uri: 'src://img',
      mediaType: 'image',
      mimeType: 'image/jpeg',
      width: 1200,
      height: 800,
    };

    const prepared = await prepareAttachment(
      { fileStore: authorFs, uploadBlob: server.uploadBlob },
      picked,
    );
    expect(prepared.descriptor.byteSize).toBe(100_000);
    expect(prepared.descriptor.contentKey).toHaveLength(64);
    expect(prepared.descriptor.noncePrefix).toHaveLength(32);
    expect(prepared.descriptor.width).toBe(1200);
    expect(server.blobs.has(prepared.descriptor.blobId)).toBe(true);

    // The local copy is ciphertext, not the plaintext, and matches the upload.
    const localCipher = await authorFs.readFile(prepared.localUri);
    expect(Array.from(localCipher)).not.toEqual(Array.from(plaintext));
    expect(Array.from(server.blobs.get(prepared.descriptor.blobId)!)).toEqual(
      Array.from(localCipher),
    );

    // Partner: project descriptor as 'remote', download, decrypt.
    const partnerExec = await freshExec();
    await insertAttachmentFromDescriptor(partnerExec, 'note-1', prepared.descriptor, {
      state: 'remote',
      localUri: null,
      createdAt: 1,
    });
    let row = await getAttachment(partnerExec, prepared.descriptor.id);
    expect(row?.state).toBe('remote');
    expect(row?.localUri).toBeNull();

    await downloadAttachment(
      { exec: partnerExec, fileStore: partnerFs, downloadBlob: server.downloadBlob },
      prepared.descriptor.id,
    );
    row = await getAttachment(partnerExec, prepared.descriptor.id);
    expect(row?.state).toBe('ready');
    expect(row?.localUri).not.toBeNull();

    const opened = await openAttachment(
      { exec: partnerExec, fileStore: partnerFs },
      prepared.descriptor.id,
    );
    expect(opened.mimeType).toBe('image/jpeg');
    expect(Array.from(await partnerFs.readFile(opened.uri))).toEqual(Array.from(plaintext));
  });

  it('download is idempotent: a ready attachment is not re-fetched', async () => {
    const partnerFs = new MemFileStore();
    const server = makeBlobServer();
    const authorFs = new MemFileStore();
    authorFs.files.set('src://a', patternBytes(2000));
    const prepared = await prepareAttachment(
      { fileStore: authorFs, uploadBlob: server.uploadBlob },
      { uri: 'src://a', mediaType: 'image', mimeType: 'image/png' },
    );
    const exec = await freshExec();
    await insertAttachmentFromDescriptor(exec, 'n', prepared.descriptor, {
      state: 'remote',
      localUri: null,
      createdAt: 1,
    });
    const deps = { exec, fileStore: partnerFs, downloadBlob: server.downloadBlob };
    await downloadAttachment(deps, prepared.descriptor.id);
    await downloadAttachment(deps, prepared.descriptor.id);
    expect(server.downloadBlob).toHaveBeenCalledTimes(1);
  });

  it('open throws on a not-yet-downloaded (remote) attachment', async () => {
    const exec = await freshExec();
    const server = makeBlobServer();
    const authorFs = new MemFileStore();
    authorFs.files.set('src://a', patternBytes(500));
    const prepared = await prepareAttachment(
      { fileStore: authorFs, uploadBlob: server.uploadBlob },
      { uri: 'src://a', mediaType: 'audio', mimeType: 'audio/m4a', durationMs: 3000 },
    );
    await insertAttachmentFromDescriptor(exec, 'n', prepared.descriptor, {
      state: 'remote',
      localUri: null,
      createdAt: 1,
    });
    await expect(
      openAttachment({ exec, fileStore: new MemFileStore() }, prepared.descriptor.id),
    ).rejects.toThrow(/not downloaded/);
  });

  it('open throws if the cached ciphertext was tampered with', async () => {
    const fs = new MemFileStore();
    const server = makeBlobServer();
    fs.files.set('src://a', patternBytes(5000));
    const prepared = await prepareAttachment(
      { fileStore: fs, uploadBlob: server.uploadBlob },
      { uri: 'src://a', mediaType: 'image', mimeType: 'image/jpeg' },
    );
    const exec = await freshExec();
    await insertAttachmentFromDescriptor(exec, 'n', prepared.descriptor, {
      state: 'ready',
      localUri: prepared.localUri,
      createdAt: 1,
    });
    // Flip a byte in the locally-cached ciphertext.
    const tampered = (await fs.readFile(prepared.localUri)).slice();
    tampered[20] ^= 0x01;
    fs.files.set(prepared.localUri, tampered);
    await expect(openAttachment({ exec, fileStore: fs }, prepared.descriptor.id)).rejects.toThrow();
  });

  it('rejects media over the size cap', async () => {
    const fs = new MemFileStore();
    fs.files.set('src://huge', new Uint8Array(26 * 1024 * 1024));
    await expect(
      prepareAttachment(
        { fileStore: fs, uploadBlob: makeBlobServer().uploadBlob },
        { uri: 'src://huge', mediaType: 'image', mimeType: 'image/jpeg' },
      ),
    ).rejects.toThrow(/size cap/);
  });
});

describe('notes with attachments (author -> wire -> partner)', () => {
  async function prepareImage(server: ReturnType<typeof makeBlobServer>): Promise<{
    prepared: Awaited<ReturnType<typeof prepareAttachment>>;
    plaintext: Uint8Array;
  }> {
    const fs = new MemFileStore();
    const plaintext = patternBytes(40_000);
    fs.files.set('src://img', plaintext);
    const prepared = await prepareAttachment(
      { fileStore: fs, uploadBlob: server.uploadBlob },
      { uri: 'src://img', mediaType: 'image', mimeType: 'image/jpeg', width: 640, height: 480 },
    );
    return { prepared, plaintext };
  }

  it('shared note with caption + image: descriptor rides the op; partner gets a remote row', async () => {
    const server = makeBlobServer();
    const { prepared, plaintext } = await prepareImage(server);
    const authorExec = await freshExec();
    const enqueued: CrdtOp[] = [];

    const note = await writeSharedNote(authorDeps(authorExec, enqueued), 'look at this', [
      prepared,
    ]);
    expect(note.body).toBe('look at this');
    const ownAtt = await listNoteAttachments(authorExec, note.id);
    expect(ownAtt).toHaveLength(1);
    expect(ownAtt[0]!.state).toBe('ready');
    expect(ownAtt[0]!.localUri).toBe(prepared.localUri);

    // Validate the op against the real wire schema, then project on the partner.
    expect(enqueued).toHaveLength(1);
    const wire = deserialiseOp(serialiseOp(enqueued[0]));
    expect(wire.kind).toBe('note.share.add');

    const partnerExec = await freshExec();
    await applyCrdtOp(partnerExec, wire, AUTHOR_PUB);
    const pNote = await getNote(partnerExec, note.id);
    expect(pNote?.body).toBe('look at this');
    const pAtt = await listNoteAttachments(partnerExec, note.id);
    expect(pAtt).toHaveLength(1);
    expect(pAtt[0]!.state).toBe('remote');
    expect(pAtt[0]!.localUri).toBeNull();
    expect(pAtt[0]!.blobId).toBe(prepared.descriptor.blobId);

    // Partner fetches + decrypts to the original bytes.
    const partnerFs = new MemFileStore();
    await downloadAttachment(
      { exec: partnerExec, fileStore: partnerFs, downloadBlob: server.downloadBlob },
      pAtt[0]!.id,
    );
    const opened = await openAttachment({ exec: partnerExec, fileStore: partnerFs }, pAtt[0]!.id);
    expect(Array.from(await partnerFs.readFile(opened.uri))).toEqual(Array.from(plaintext));
  });

  it('media-only shared note: no body on the wire, attachment present', async () => {
    const server = makeBlobServer();
    const { prepared } = await prepareImage(server);
    const authorExec = await freshExec();
    const enqueued: CrdtOp[] = [];

    const note = await writeSharedNote(authorDeps(authorExec, enqueued), '', [prepared]);
    expect(note.body).toBeNull();
    const json = new TextDecoder().decode(serialiseOp(enqueued[0]));
    expect(json).not.toContain('"body"');
    expect(json).toContain('attachments');

    const partnerExec = await freshExec();
    await applyCrdtOp(partnerExec, deserialiseOp(serialiseOp(enqueued[0])), AUTHOR_PUB);
    const pNote = await getNote(partnerExec, note.id);
    expect(pNote?.body).toBeNull();
    expect(await listNoteAttachments(partnerExec, note.id)).toHaveLength(1);
  });

  it('secret note with media: announce carries nothing; reveal carries body + media', async () => {
    const server = makeBlobServer();
    const { prepared } = await prepareImage(server);
    const authorExec = await freshExec();
    const enqueued: CrdtOp[] = [];
    const deps = authorDeps(authorExec, enqueued);

    const note = await writeSecretNote(deps, 'hidden caption', [prepared]);
    // Announce op leaks neither the body nor the media descriptor.
    const announceJson = new TextDecoder().decode(serialiseOp(enqueued[0]));
    expect(announceJson).not.toContain('hidden caption');
    expect(announceJson).not.toContain('attachments');
    expect(announceJson).not.toContain(prepared.descriptor.blobId);

    // Partner sees the announce: a bodyless secret with no attachments yet.
    const partnerExec = await freshExec();
    await applyCrdtOp(partnerExec, deserialiseOp(serialiseOp(enqueued[0])), AUTHOR_PUB);
    expect((await getNote(partnerExec, note.id))?.body).toBeNull();
    expect(await listNoteAttachments(partnerExec, note.id)).toHaveLength(0);

    // Reveal: body + media now ride the wire.
    enqueued.length = 0;
    await revealSecretNote(deps, note.id);
    expect(enqueued).toHaveLength(1);
    const revealWire = deserialiseOp(serialiseOp(enqueued[0]));
    expect(revealWire.kind).toBe('note.secret.reveal');
    await applyCrdtOp(partnerExec, revealWire, AUTHOR_PUB);
    expect((await getNote(partnerExec, note.id))?.body).toBe('hidden caption');
    const pAtt = await listNoteAttachments(partnerExec, note.id);
    expect(pAtt).toHaveLength(1);
    expect(pAtt[0]!.state).toBe('remote');
  });

  it('rejects a note with neither body nor media', async () => {
    const exec = await freshExec();
    await expect(writeSharedNote(authorDeps(exec, []), '', [])).rejects.toThrow(
      /body or attachment/,
    );
    await expect(writeSecretNote(authorDeps(exec, []), '', [])).rejects.toThrow(
      /body or attachment/,
    );
  });
});
