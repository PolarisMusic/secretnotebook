import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import {
  SEVER_GRACE_SECONDS,
  cancelSever,
  getSeverState,
  isSeverDue,
  maybeFinalizeSever,
  scheduleSever,
  type SeverStoreDeps,
} from '../src/features/connection/sever';
import { nodeExecutor } from './helpers/sqlite-executor';

const SELF = new Uint8Array(32).fill(0x11);
const PEER = new Uint8Array(32).fill(0x22);
const FIXED_NOW = new Date('2026-05-21T08:00:00.000Z');
const NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);

interface Harness {
  exec: SqlExecutor;
  deps: SeverStoreDeps;
  enqueued: Array<{ kind: string; [k: string]: unknown }>;
}

async function freshHarness(selfPubkey: Uint8Array = SELF): Promise<Harness> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  await exec.execute(
    `INSERT INTO connection (id, partner_a_pubkey, partner_b_pubkey,
        channel_root_key_wrapped, paired_at, status)
     VALUES ('c1', ?, ?, X'00', ?, 'paired')`,
    [SELF, PEER, NOW_SEC],
  );
  const enqueued: Array<{ kind: string; [k: string]: unknown }> = [];
  const deps: SeverStoreDeps = {
    exec,
    selfPubkey,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op as unknown as { kind: string });
    },
  };
  return { exec, deps, enqueued };
}

describe('connection sever store', () => {
  it('isSeverDue compares severAt against now', () => {
    expect(isSeverDue(null, NOW_SEC)).toBe(false);
    expect(isSeverDue(NOW_SEC + 10, NOW_SEC)).toBe(false);
    expect(isSeverDue(NOW_SEC, NOW_SEC)).toBe(true);
    expect(isSeverDue(NOW_SEC - 1, NOW_SEC)).toBe(true);
  });

  it('scheduleSever stamps the row (now + 7d) and enqueues a schedule op', async () => {
    const { exec, deps, enqueued } = await freshHarness();
    const at = await scheduleSever(deps);
    expect(at).toBe(NOW_SEC + SEVER_GRACE_SECONDS);

    const state = await getSeverState(exec);
    expect(state?.severAt).toBe(at);
    expect(state?.initiatedBy && bytesToHex(state.initiatedBy)).toBe(bytesToHex(SELF));

    expect(enqueued).toEqual([
      { v: 1, kind: 'connection.sever.schedule', byPubkey: bytesToHex(SELF), severAt: at },
    ]);
  });

  it('graceSeconds:0 ("end now") schedules immediately', async () => {
    const { deps } = await freshHarness();
    const at = await scheduleSever(deps, { graceSeconds: 0 });
    expect(at).toBe(NOW_SEC);
    expect(isSeverDue(at, NOW_SEC)).toBe(true);
  });

  it('the initiator can cancel; the columns clear and a cancel op is enqueued', async () => {
    const { exec, deps, enqueued } = await freshHarness();
    await scheduleSever(deps);
    enqueued.length = 0;

    await cancelSever(deps);
    const state = await getSeverState(exec);
    expect(state?.severAt).toBeNull();
    expect(state?.initiatedBy).toBeNull();
    expect(enqueued.at(-1)).toMatchObject({
      kind: 'connection.sever.cancel',
      byPubkey: bytesToHex(SELF),
    });
  });

  it('a non-initiator cannot cancel', async () => {
    // SELF schedules; PEER (a different deps) tries to cancel.
    const { exec, deps } = await freshHarness();
    await scheduleSever(deps);
    const peerDeps: SeverStoreDeps = { ...deps, selfPubkey: PEER };
    await expect(cancelSever(peerDeps)).rejects.toThrow(/only the partner who started/);
    // Still pending.
    expect((await getSeverState(exec))?.severAt).not.toBeNull();
  });

  it('maybeFinalizeSever wipes once due and is a no-op before then', async () => {
    const { exec, deps } = await freshHarness();
    await exec.execute(
      `INSERT INTO note (id, kind, author_pubkey, body, created_at) VALUES ('n1','shared',?, 'hi', ?)`,
      [SELF, NOW_SEC],
    );
    await scheduleSever(deps); // due in 7d

    // Before the window elapses: nothing happens.
    expect(await maybeFinalizeSever({ exec, now: () => FIXED_NOW })).toBe(false);
    expect((await getSeverState(exec))?.severAt).not.toBeNull();

    // After it elapses: wipe. Connection row gone → getSeverState null.
    const after = (): Date => new Date(FIXED_NOW.getTime() + (SEVER_GRACE_SECONDS + 1) * 1000);
    expect(await maybeFinalizeSever({ exec, now: after })).toBe(true);
    expect(await getSeverState(exec)).toBeNull();
    const notes = await exec.query<{ n: number }>(`SELECT COUNT(*) AS n FROM note`);
    expect(notes[0]?.n).toBe(0);
  });
});
