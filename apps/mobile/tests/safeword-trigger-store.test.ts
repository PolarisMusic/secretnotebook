import { describe, expect, it } from '@jest/globals';
import type {
  ConnectionSafeWordAckOp,
  ConnectionSafeWordTriggerOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import type { SqlExecutor } from '../src/db/executor';
import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { applyCrdtOp } from '../src/features/connection-channel/projector';
import {
  ackTrigger,
  fireTrigger,
  getActiveTrigger,
  type TriggerStoreDeps,
} from '../src/features/safeword/trigger-store';
import { nodeExecutor } from './helpers/sqlite-executor';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);
const STRANGER_PUB = new Uint8Array(32).fill(0xee);
const ROOT_KEY = new Uint8Array(32).fill(0xab);
const FIXED_NOW = new Date('2026-06-14T09:00:00.000Z');

type TriggerOp = ConnectionSafeWordTriggerOp | ConnectionSafeWordAckOp;

interface Device {
  exec: SqlExecutor;
  deps: TriggerStoreDeps;
  enqueued: TriggerOp[];
}

async function freshDevice(self: Uint8Array, opts: { confirmed?: boolean } = {}): Promise<Device> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  await exec.execute(
    `INSERT INTO connection (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status,
       safeword_term, safeword_confirmed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      CONNECTION_ID,
      A_PUB,
      B_PUB,
      ROOT_KEY,
      1_700_000_000,
      'paired',
      opts.confirmed ? 'butterscotch' : null,
      opts.confirmed ? 1_700_000_500 : null,
    ],
  );
  const enqueued: TriggerOp[] = [];
  const deps: TriggerStoreDeps = {
    exec,
    selfPubkey: self,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op);
    },
  };
  return { exec, deps, enqueued };
}

describe('safeword trigger store', () => {
  it('refuses to fire without a confirmed term', async () => {
    const a = await freshDevice(A_PUB, { confirmed: false });
    await expect(fireTrigger(a.deps)).rejects.toThrow(/term/i);
    expect(a.enqueued).toHaveLength(0);
  });

  it('fire → partner alerted → ack clears it on both sides', async () => {
    const a = await freshDevice(A_PUB, { confirmed: true });
    const b = await freshDevice(B_PUB, { confirmed: true });

    const id = await fireTrigger(a.deps);
    // The firer is waiting (outbound).
    const aActive = await getActiveTrigger(a.exec, A_PUB);
    expect(aActive?.direction).toBe('outbound');
    expect(aActive?.id).toBe(id);

    const triggerOp = a.enqueued[0];
    expect(triggerOp.kind).toBe('connection.safeword.trigger');

    // B receives it (sender = peer = A) and sees an inbound alert.
    await applyCrdtOp(b.exec, triggerOp, A_PUB);
    const bActive = await getActiveTrigger(b.exec, B_PUB);
    expect(bActive?.direction).toBe('inbound');
    expect(bActive?.id).toBe(id);

    // B acknowledges; the alert clears for B and an ack op is enqueued.
    await ackTrigger(b.deps, id);
    expect(await getActiveTrigger(b.exec, B_PUB)).toBeNull();
    const ackOp = b.enqueued[0];
    expect(ackOp.kind).toBe('connection.safeword.ack');

    // A receives the ack (sender = peer = B); its waiting state clears too.
    await applyCrdtOp(a.exec, ackOp, B_PUB);
    expect(await getActiveTrigger(a.exec, A_PUB)).toBeNull();
  });

  it('a replayed trigger op collapses to a single row', async () => {
    const a = await freshDevice(A_PUB, { confirmed: true });
    const b = await freshDevice(B_PUB, { confirmed: true });
    const id = await fireTrigger(a.deps);
    const op = a.enqueued[0];
    await applyCrdtOp(b.exec, op, A_PUB);
    await applyCrdtOp(b.exec, op, A_PUB); // replay
    const rows = await b.exec.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM safeword_trigger WHERE id = ?`,
      [id],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('projector rejects a trigger op whose author is not the sender', async () => {
    const b = await freshDevice(B_PUB, { confirmed: true });
    const spoof: ConnectionSafeWordTriggerOp = {
      v: 1,
      kind: 'connection.safeword.trigger',
      id: '99999999-9999-9999-9999-999999999999',
      triggeredByPubkey: bytesToHex(A_PUB),
      triggeredAt: 1_700_000_900,
    };
    await expect(applyCrdtOp(b.exec, spoof, STRANGER_PUB)).rejects.toThrow(/does not match sender/);
  });
});
