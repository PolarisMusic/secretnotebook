import { describe, expect, it } from '@jest/globals';
import type { ConnectionRoleSetOp } from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import type { SqlExecutor } from '../src/db/executor';
import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import {
  getConnectionRoles,
  setMyRole,
  type RoleStoreDeps,
} from '../src/features/connection/role-store';
import { nodeExecutor } from './helpers/sqlite-executor';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);
const STRANGER_PUB = new Uint8Array(32).fill(0xee);
const ROOT_KEY = new Uint8Array(32).fill(0xab);
const FIXED_NOW = new Date('2026-05-22T09:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);

interface Harness {
  exec: SqlExecutor;
  deps: RoleStoreDeps;
  enqueued: ConnectionRoleSetOp[];
}

async function freshHarness(
  self: Uint8Array,
  opts: { withConnection?: boolean } = {},
): Promise<Harness> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  if (opts.withConnection ?? true) {
    await exec.execute(
      `INSERT INTO connection (
         id, partner_a_pubkey, partner_b_pubkey,
         channel_root_key_wrapped, paired_at, status
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [CONNECTION_ID, A_PUB, B_PUB, ROOT_KEY, 1_700_000_000, 'paired'],
    );
  }
  const enqueued: ConnectionRoleSetOp[] = [];
  const deps: RoleStoreDeps = {
    exec,
    selfPubkey: self,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op);
    },
  };
  return { exec, deps, enqueued };
}

describe('connection role store', () => {
  describe('setMyRole', () => {
    it('writes partner_a_role when self is side A and enqueues the op', async () => {
      const { exec, deps, enqueued } = await freshHarness(A_PUB);
      await setMyRole(deps, 'masculine');

      const snap = await getConnectionRoles(exec);
      expect(snap?.partnerARole).toBe('masculine');
      expect(snap?.partnerBRole).toBeNull();

      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]).toEqual({
        v: 1,
        kind: 'connection.role.set',
        setterPubkey: bytesToHex(A_PUB),
        role: 'masculine',
        setAt: FIXED_NOW_SEC,
      });
    });

    it('writes partner_b_role when self is side B and enqueues the op', async () => {
      const { exec, deps, enqueued } = await freshHarness(B_PUB);
      await setMyRole(deps, 'feminine');

      const snap = await getConnectionRoles(exec);
      expect(snap?.partnerARole).toBeNull();
      expect(snap?.partnerBRole).toBe('feminine');

      expect(enqueued[0]?.setterPubkey).toBe(bytesToHex(B_PUB));
      expect(enqueued[0]?.role).toBe('feminine');
    });

    it('overwrites the previous role on a second call (last-write-wins)', async () => {
      const { exec, deps } = await freshHarness(A_PUB);
      await setMyRole(deps, 'masculine');
      await setMyRole(deps, 'neutral');
      const snap = await getConnectionRoles(exec);
      expect(snap?.partnerARole).toBe('neutral');
    });

    it('throws when no connection row exists', async () => {
      const { deps } = await freshHarness(A_PUB, { withConnection: false });
      await expect(setMyRole(deps, 'masculine')).rejects.toThrow(/no active connection/);
    });

    it("throws when self pubkey doesn't match either partner on this connection", async () => {
      const { deps } = await freshHarness(STRANGER_PUB);
      await expect(setMyRole(deps, 'neutral')).rejects.toThrow(/does not match either partner/);
    });

    it('rolls back the local UPDATE if enqueue throws (transaction guarantee)', async () => {
      const { exec, deps } = await freshHarness(A_PUB);
      const real = deps.enqueue;
      const failing: RoleStoreDeps = {
        ...deps,
        enqueue: async () => {
          throw new Error('outbox is down');
        },
      };
      await expect(setMyRole(failing, 'masculine')).rejects.toThrow(/outbox is down/);
      const snap = await getConnectionRoles(exec);
      expect(snap?.partnerARole).toBeNull();
      // sanity: the original deps still work afterwards
      await real({
        v: 1,
        kind: 'connection.role.set',
        setterPubkey: bytesToHex(A_PUB),
        role: 'masculine',
        setAt: FIXED_NOW_SEC,
      });
    });
  });

  describe('getConnectionRoles', () => {
    it('returns null on a device without a connection row', async () => {
      const { exec } = await freshHarness(A_PUB, { withConnection: false });
      expect(await getConnectionRoles(exec)).toBeNull();
    });

    it('returns both roles + the connection id', async () => {
      const { exec, deps } = await freshHarness(A_PUB);
      await setMyRole(deps, 'masculine');
      const snap = await getConnectionRoles(exec);
      expect(snap?.connectionId).toBe(CONNECTION_ID);
      expect(snap?.partnerARole).toBe('masculine');
      expect(snap?.partnerBRole).toBeNull();
    });
  });
});
