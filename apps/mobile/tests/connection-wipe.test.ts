import { describe, expect, it, jest } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import { wipeConnectionData } from '../src/features/connection/wipe';
import { nodeExecutor } from './helpers/sqlite-executor';

const SELF = new Uint8Array(32).fill(0x11);
const PEER = new Uint8Array(32).fill(0x22);
const NOW = 1_700_000_000;

async function count(exec: SqlExecutor, table: string): Promise<number> {
  const rows = await exec.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

async function seedAll(exec: SqlExecutor): Promise<void> {
  // Connection-scoped rows.
  await exec.execute(
    `INSERT INTO connection (id, partner_a_pubkey, partner_b_pubkey,
        channel_root_key_wrapped, paired_at, status)
     VALUES ('c1', ?, ?, X'00', ?, 'paired')`,
    [SELF, PEER, NOW],
  );
  await exec.execute(
    `INSERT INTO note (id, kind, author_pubkey, body, created_at)
     VALUES ('n1', 'secret', ?, 'secret body', ?)`,
    [SELF, NOW],
  );
  await exec.execute(
    `INSERT INTO saved_post (id, global_post_id, saved_by_pubkey, saved_for_pubkey, created_at)
     VALUES ('s1', 'g1', ?, ?, ?)`,
    [SELF, PEER, NOW],
  );
  await exec.execute(
    `INSERT INTO secret_unlock (id, author_pubkey, unlocker_pubkey, prompt_key, state, created_at)
     VALUES ('u1', ?, ?, 'k', 'revealed', ?)`,
    [SELF, PEER, NOW],
  );
  await exec.execute(
    `INSERT INTO secret_unlock_reflection (attempt_id, by_pubkey, appreciate, uncomfortable, stars, reflected_at)
     VALUES ('u1', ?, 'a', 'b', NULL, ?)`,
    [SELF, NOW],
  );
  await exec.execute(
    `INSERT INTO ledger_entry (id, kind, delta, reason, ref_id, created_at)
     VALUES ('l1', 'couple_points', 500, 'unlock_verified', 'u1', ?)`,
    [NOW],
  );
  await exec.execute(
    `INSERT INTO safeword_trigger (id, triggered_by_pubkey, triggered_at, acked_at)
     VALUES ('t1', ?, ?, NULL)`,
    [SELF, NOW],
  );
  await exec.execute(
    `INSERT INTO sync_outbox (id, envelope, recipient_pubkey, attempts, next_attempt_at)
     VALUES ('o1', '{}', ?, 0, ?)`,
    [PEER, NOW],
  );
  await exec.execute(`INSERT INTO sync_seen (envelope_hash) VALUES (X'abcd')`);

  // Non-connection rows that MUST survive a sever.
  await exec.execute(`INSERT INTO profiles (id, display_name) VALUES ('p1', 'Me')`);
  await exec.execute(
    `INSERT INTO post_cache (global_id, content_type, body, anon_author_id)
     VALUES ('pc1', 'text', 'cached', X'01')`,
  );
  await exec.execute(`INSERT INTO app_setting (key, value) VALUES ('intro_seen', '1')`);
}

describe('wipeConnectionData', () => {
  it('clears every connection-scoped table and calls the file wipe', async () => {
    const db = new Database(':memory:');
    const exec = nodeExecutor(db);
    await runMigrations(exec, MIGRATIONS);
    await seedAll(exec);
    const deleteAttachmentFiles = jest.fn(async () => undefined);

    await wipeConnectionData(exec, { deleteAttachmentFiles });

    for (const table of [
      'connection',
      'note',
      'saved_post',
      'secret_unlock',
      'secret_unlock_reflection',
      'ledger_entry',
      'safeword_trigger',
      'sync_outbox',
      'sync_seen',
      'connection_ratchet',
      'attachment',
    ]) {
      expect(await count(exec, table)).toBe(0);
    }
    expect(deleteAttachmentFiles).toHaveBeenCalledTimes(1);
  });

  it('keeps device-global data so the device can re-pair', async () => {
    const db = new Database(':memory:');
    const exec = nodeExecutor(db);
    await runMigrations(exec, MIGRATIONS);
    await seedAll(exec);

    await wipeConnectionData(exec);

    expect(await count(exec, 'profiles')).toBe(1);
    expect(await count(exec, 'post_cache')).toBe(1);
    expect(await count(exec, 'app_setting')).toBe(1);
  });
});
