import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { persistCouple } from '../src/features/pairing/persistence';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshDb() {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return { db, exec };
}

interface CoupleRow {
  id: string;
  partner_a_pubkey: Buffer;
  partner_b_pubkey: Buffer;
  channel_root_key_wrapped: Buffer;
  paired_at: number;
  status: string;
}

describe('persistCouple', () => {
  const rootKey = new Uint8Array(32).fill(0xab);
  const selfPub = new Uint8Array(32).fill(0x01);
  const peerPub = new Uint8Array(32).fill(0x02);

  it('inserts a couple row with status awaiting_safeword', async () => {
    const { db, exec } = await freshDb();
    const { coupleId } = await persistCouple(
      exec,
      { rootKey, selfPub, peerPub },
      () => 1_700_000_000_000,
    );
    expect(coupleId).toMatch(/^[0-9a-f]{32}$/);

    const row = db.prepare('SELECT * FROM couple WHERE id = ?').get(coupleId) as CoupleRow;
    expect(row.status).toBe('awaiting_safeword');
    expect(row.paired_at).toBe(1_700_000_000);
    expect(Array.from(row.channel_root_key_wrapped)).toEqual(Array.from(rootKey));
  });

  it('derives a canonical id regardless of which side computes it (acceptance criterion)', async () => {
    const dbA = await freshDb();
    const dbB = await freshDb();

    const sideA = await persistCouple(dbA.exec, { rootKey, selfPub, peerPub });
    const sideB = await persistCouple(dbB.exec, {
      rootKey,
      selfPub: peerPub, // swap perspective
      peerPub: selfPub,
    });

    expect(sideA.coupleId).toBe(sideB.coupleId);
  });

  it('stores pubkeys in canonical (lex-sorted) order', async () => {
    const { db, exec } = await freshDb();
    const lo = new Uint8Array(32).fill(0x05);
    const hi = new Uint8Array(32).fill(0x09);

    // Same key material, two different self/peer perspectives.
    await persistCouple(exec, { rootKey, selfPub: hi, peerPub: lo });
    const row = db.prepare('SELECT * FROM couple').get() as CoupleRow;
    expect(row.partner_a_pubkey[0]).toBe(0x05);
    expect(row.partner_b_pubkey[0]).toBe(0x09);
  });

  it('is idempotent on the same input (ON CONFLICT DO NOTHING)', async () => {
    const { db, exec } = await freshDb();
    await persistCouple(exec, { rootKey, selfPub, peerPub });
    await persistCouple(exec, { rootKey, selfPub, peerPub });
    const rows = db.prepare('SELECT id FROM couple').all();
    expect(rows).toHaveLength(1);
  });

  it('rejects wrong-size inputs', async () => {
    const { exec } = await freshDb();
    await expect(
      persistCouple(exec, { rootKey: new Uint8Array(16), selfPub, peerPub }),
    ).rejects.toThrow(/rootKey/);
    await expect(
      persistCouple(exec, { rootKey, selfPub: new Uint8Array(16), peerPub }),
    ).rejects.toThrow(/selfPub/);
    await expect(
      persistCouple(exec, { rootKey, selfPub, peerPub: new Uint8Array(16) }),
    ).rejects.toThrow(/peerPub/);
  });
});
