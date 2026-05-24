import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import {
  initRatchetForConnectionSide,
  ratchetDecrypt,
  ratchetEncrypt,
} from '@secretnotebook/connection-protocol';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import {
  initAndSaveRatchet,
  loadRatchet,
  saveInitialRatchet,
  saveRatchet,
} from '../src/features/connection-channel/ratchet-store';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshDb(): Promise<{
  exec: ReturnType<typeof nodeExecutor>;
  connectionId: string;
}> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  // Seed a connection row so the FK reference in connection_ratchet is valid.
  const connectionId = '11111111-1111-1111-1111-111111111111';
  await exec.execute(
    `INSERT INTO connection (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      connectionId,
      new Uint8Array(32).fill(0x10),
      new Uint8Array(32).fill(0x20),
      new Uint8Array(32).fill(0x42),
      1_700_000_000,
      'awaiting_safeword',
    ],
  );
  return { exec, connectionId };
}

describe('initAndSaveRatchet', () => {
  it('derives the side from the two pubkeys and persists a row', async () => {
    const { exec, connectionId } = await freshDb();
    const smaller = new Uint8Array(32).fill(0x10);
    const larger = new Uint8Array(32).fill(0x20);
    const { side, state } = await initAndSaveRatchet(
      exec,
      {
        connectionId,
        rootKey: new Uint8Array(32).fill(0x42),
        selfPub: smaller,
        peerPub: larger,
      },
      () => 1_700_000_000_000,
    );
    expect(side).toBe('a');
    expect(state.sendingCounter).toBe(0);

    const loaded = await loadRatchet(exec, connectionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.side).toBe('a');
    expect(bytesToHex(loaded!.state.sendingChainKey)).toBe(bytesToHex(state.sendingChainKey));
    expect(bytesToHex(loaded!.state.receivingChainKey)).toBe(bytesToHex(state.receivingChainKey));
    expect(loaded!.state.skipped.size).toBe(0);
  });

  it("the other partner derives side 'b' from the same root, mirror chains", async () => {
    const { exec, connectionId } = await freshDb();
    const smaller = new Uint8Array(32).fill(0x10);
    const larger = new Uint8Array(32).fill(0x20);
    const root = new Uint8Array(32).fill(0x42);

    // Two devices, two separate DBs.
    const { side: sideA, state: stateA } = await initAndSaveRatchet(
      exec,
      { connectionId, rootKey: root, selfPub: smaller, peerPub: larger },
      () => 1_700_000_000_000,
    );

    const { exec: execB, connectionId: cid2 } = await freshDb();
    const { side: sideB, state: stateB } = await initAndSaveRatchet(
      execB,
      { connectionId: cid2, rootKey: root, selfPub: larger, peerPub: smaller },
      () => 1_700_000_000_000,
    );
    expect(sideA).toBe('a');
    expect(sideB).toBe('b');
    // A's sending chain == B's receiving chain == B can decrypt A.
    expect(bytesToHex(stateA.sendingChainKey)).toBe(bytesToHex(stateB.receivingChainKey));
    expect(bytesToHex(stateA.receivingChainKey)).toBe(bytesToHex(stateB.sendingChainKey));
  });

  it('is idempotent — a second call does not replace the first row', async () => {
    const { exec, connectionId } = await freshDb();
    const root = new Uint8Array(32).fill(0x42);
    const self = new Uint8Array(32).fill(0x10);
    const peer = new Uint8Array(32).fill(0x20);

    const first = await initAndSaveRatchet(exec, {
      connectionId,
      rootKey: root,
      selfPub: self,
      peerPub: peer,
    });
    // Advance the in-memory state to make sure a re-init doesn't roll it back.
    const env = await ratchetEncrypt(first.state, new TextEncoder().encode('hi'));
    void env;
    await saveRatchet(exec, connectionId, first.state, () => 2_000_000_000_000);

    const second = await initAndSaveRatchet(exec, {
      connectionId,
      rootKey: root,
      selfPub: self,
      peerPub: peer,
    });
    expect(second.side).toBe('a');
    const loaded = await loadRatchet(exec, connectionId);
    // The previously-bumped sendingCounter wins because ON CONFLICT
    // DO NOTHING preserved the existing row.
    expect(loaded!.state.sendingCounter).toBe(first.state.sendingCounter);
  });
});

describe('saveRatchet / loadRatchet round-trip after encrypt', () => {
  it('survives a simulated cold start: persist after encrypt, reload, decrypt on partner', async () => {
    const root = new Uint8Array(32).fill(0x99);
    const aSelf = new Uint8Array(32).fill(0x10);
    const bSelf = new Uint8Array(32).fill(0x20);

    const { exec: execA, connectionId: cidA } = await freshDb();
    const { exec: execB, connectionId: cidB } = await freshDb();
    const { state: aState } = await initAndSaveRatchet(execA, {
      connectionId: cidA,
      rootKey: root,
      selfPub: aSelf,
      peerPub: bSelf,
    });
    await initAndSaveRatchet(execB, {
      connectionId: cidB,
      rootKey: root,
      selfPub: bSelf,
      peerPub: aSelf,
    });

    // A encrypts twice, then "crashes" — we drop the in-memory state
    // and reload from the DB to send a third message.
    const env0 = await ratchetEncrypt(aState, new TextEncoder().encode('zero'));
    const env1 = await ratchetEncrypt(aState, new TextEncoder().encode('one'));
    await saveRatchet(execA, cidA, aState);

    const reloaded = await loadRatchet(execA, cidA);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.state.sendingCounter).toBe(2);
    const env2 = await ratchetEncrypt(reloaded!.state, new TextEncoder().encode('two'));
    await saveRatchet(execA, cidA, reloaded!.state);

    // B reloads from disk too and decrypts all three in order.
    const bReload = await loadRatchet(execB, cidB);
    const got0 = await ratchetDecrypt(bReload!.state, env0.header, env0.ciphertext);
    const got1 = await ratchetDecrypt(bReload!.state, env1.header, env1.ciphertext);
    const got2 = await ratchetDecrypt(bReload!.state, env2.header, env2.ciphertext);
    expect(new TextDecoder().decode(got0)).toBe('zero');
    expect(new TextDecoder().decode(got1)).toBe('one');
    expect(new TextDecoder().decode(got2)).toBe('two');
    await saveRatchet(execB, cidB, bReload!.state);

    const bAfter = await loadRatchet(execB, cidB);
    expect(bAfter!.state.receivingCounter).toBe(3);
    expect(bAfter!.state.skipped.size).toBe(0);
  });

  it('persists the skipped-keys cache across reload (out-of-order → reload → in-order)', async () => {
    const root = new Uint8Array(32).fill(0xab);
    const aSelf = new Uint8Array(32).fill(0x10);
    const bSelf = new Uint8Array(32).fill(0x20);
    const { exec: execA, connectionId: cidA } = await freshDb();
    const { exec: execB, connectionId: cidB } = await freshDb();
    const { state: aState } = await initAndSaveRatchet(execA, {
      connectionId: cidA,
      rootKey: root,
      selfPub: aSelf,
      peerPub: bSelf,
    });
    const { state: bState } = await initAndSaveRatchet(execB, {
      connectionId: cidB,
      rootKey: root,
      selfPub: bSelf,
      peerPub: aSelf,
    });

    const e0 = await ratchetEncrypt(aState, new TextEncoder().encode('zero'));
    const e1 = await ratchetEncrypt(aState, new TextEncoder().encode('one'));
    const e2 = await ratchetEncrypt(aState, new TextEncoder().encode('two'));

    // B receives e2 first → 0 and 1 stashed.
    await ratchetDecrypt(bState, e2.header, e2.ciphertext);
    expect(bState.skipped.size).toBe(2);
    await saveRatchet(execB, cidB, bState);

    // Cold start: discard bState, reload from disk.
    const reload = await loadRatchet(execB, cidB);
    expect(reload!.state.skipped.size).toBe(2);

    // Receive the delayed envelopes — they should decrypt cleanly.
    const got0 = await ratchetDecrypt(reload!.state, e0.header, e0.ciphertext);
    const got1 = await ratchetDecrypt(reload!.state, e1.header, e1.ciphertext);
    expect(new TextDecoder().decode(got0)).toBe('zero');
    expect(new TextDecoder().decode(got1)).toBe('one');
    expect(reload!.state.skipped.size).toBe(0);
  });
});

describe('saveInitialRatchet edge cases', () => {
  it('refuses to insert against a missing connection row (FK violation)', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const exec = nodeExecutor(db);
    await runMigrations(exec, MIGRATIONS);
    const state = await initRatchetForConnectionSide(new Uint8Array(32).fill(0x01), 'a');
    await expect(
      saveInitialRatchet(exec, { connectionId: 'no-such-connection', side: 'a', state }),
    ).rejects.toBeTruthy();
  });
});

describe('loadRatchet on missing row', () => {
  it('returns null when no row exists for the connection', async () => {
    const { exec } = await freshDb();
    expect(await loadRatchet(exec, 'unknown-connection-id')).toBeNull();
  });
});
