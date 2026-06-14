import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { persistConnection } from '../src/features/pairing/persistence';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshDb() {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return { db, exec };
}

interface ConnectionRow {
  id: string;
  partner_a_pubkey: Buffer;
  partner_b_pubkey: Buffer;
  channel_root_key_wrapped: Buffer;
  paired_at: number;
  status: string;
}

describe('persistConnection', () => {
  const rootKey = new Uint8Array(32).fill(0xab);
  const selfPub = new Uint8Array(32).fill(0x01);
  const peerPub = new Uint8Array(32).fill(0x02);

  it('inserts a connection row with status paired and returns the self side', async () => {
    const { db, exec } = await freshDb();
    const { connectionId, selfSide } = await persistConnection(
      exec,
      { rootKey, selfPub, peerPub },
      () => 1_700_000_000_000,
    );
    expect(connectionId).toMatch(/^[0-9a-f]{32}$/);
    // selfPub (0x01..) < peerPub (0x02..) → 'a'.
    expect(selfSide).toBe('a');

    const row = db
      .prepare('SELECT * FROM connection WHERE id = ?')
      .get(connectionId) as ConnectionRow;
    expect(row.status).toBe('paired');
    expect(row.paired_at).toBe(1_700_000_000);
    expect(Array.from(row.channel_root_key_wrapped)).toEqual(Array.from(rootKey));

    // The migration also seeded a connection_ratchet row keyed on the same id.
    const ratchet = db
      .prepare(
        'SELECT self_side, sending_counter, receiving_counter FROM connection_ratchet WHERE connection_id = ?',
      )
      .get(connectionId) as {
      self_side: string;
      sending_counter: number;
      receiving_counter: number;
    };
    expect(ratchet.self_side).toBe('a');
    expect(ratchet.sending_counter).toBe(0);
    expect(ratchet.receiving_counter).toBe(0);
  });

  it("returns selfSide 'b' for the partner whose pubkey sorts higher", async () => {
    const { exec } = await freshDb();
    const { selfSide } = await persistConnection(exec, {
      rootKey,
      selfPub: peerPub, // 0x02..
      peerPub: selfPub, // 0x01..
    });
    expect(selfSide).toBe('b');
  });

  it('derives a canonical id regardless of which side computes it (acceptance criterion)', async () => {
    const dbA = await freshDb();
    const dbB = await freshDb();

    const sideA = await persistConnection(dbA.exec, { rootKey, selfPub, peerPub });
    const sideB = await persistConnection(dbB.exec, {
      rootKey,
      selfPub: peerPub, // swap perspective
      peerPub: selfPub,
    });

    expect(sideA.connectionId).toBe(sideB.connectionId);
  });

  it('stores pubkeys in canonical (lex-sorted) order', async () => {
    const { db, exec } = await freshDb();
    const lo = new Uint8Array(32).fill(0x05);
    const hi = new Uint8Array(32).fill(0x09);

    // Same key material, two different self/peer perspectives.
    await persistConnection(exec, { rootKey, selfPub: hi, peerPub: lo });
    const row = db.prepare('SELECT * FROM connection').get() as ConnectionRow;
    expect(row.partner_a_pubkey[0]).toBe(0x05);
    expect(row.partner_b_pubkey[0]).toBe(0x09);
  });

  it('is idempotent on the same input (ON CONFLICT DO NOTHING)', async () => {
    const { db, exec } = await freshDb();
    await persistConnection(exec, { rootKey, selfPub, peerPub });
    await persistConnection(exec, { rootKey, selfPub, peerPub });
    const rows = db.prepare('SELECT id FROM connection').all();
    expect(rows).toHaveLength(1);
  });

  it('rejects wrong-size inputs', async () => {
    const { exec } = await freshDb();
    await expect(
      persistConnection(exec, { rootKey: new Uint8Array(16), selfPub, peerPub }),
    ).rejects.toThrow(/rootKey/);
    await expect(
      persistConnection(exec, { rootKey, selfPub: new Uint8Array(16), peerPub }),
    ).rejects.toThrow(/selfPub/);
    await expect(
      persistConnection(exec, { rootKey, selfPub, peerPub: new Uint8Array(16) }),
    ).rejects.toThrow(/peerPub/);
  });
});
