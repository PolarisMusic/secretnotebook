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
  // A note that was published to the global feed — kept across a sever.
  await exec.execute(
    `INSERT INTO note (id, kind, author_pubkey, body, created_at, published_at, published_global_post_id)
     VALUES ('n2', 'shared', ?, 'published body', ?, ?, 'g-pub-1')`,
    [SELF, NOW, NOW],
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
    `INSERT INTO secret_unlock_reflection (attempt_id, by_pubkey, appreciate, uncomfortable, reflected_at)
     VALUES ('u1', ?, 'a', 'b', ?)`,
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
  it('wipes connection-scoped tables, keeps the public footprint, and calls the file wipe', async () => {
    const db = new Database(':memory:');
    const exec = nodeExecutor(db);
    await runMigrations(exec, MIGRATIONS);
    await seedAll(exec);
    const deleteAttachmentFiles = jest.fn(async () => undefined);

    await wipeConnectionData(exec, { deleteAttachmentFiles });

    for (const table of [
      'connection',
      'secret_unlock',
      'secret_unlock_reflection',
      'note',
      'ledger_entry',
      'safeword_trigger',
      'sync_outbox',
      'sync_seen',
      'connection_ratchet',
      'attachment',
    ]) {
      expect(await count(exec, table)).toBe(0);
    }
    // Public footprint preserved: saved posts (saves of others' public posts)
    // are kept in full; a published note's content survives in post_cache + on
    // the server feed, not as a local note row.
    expect(await count(exec, 'saved_post')).toBe(1);
    expect(await count(exec, 'post_cache')).toBe(1);
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

  it('keeps saved posts but wipes all notes (published survive via post_cache)', async () => {
    const db = new Database(':memory:');
    const exec = nodeExecutor(db);
    await runMigrations(exec, MIGRATIONS);
    await seedAll(exec);

    await wipeConnectionData(exec);

    // Saved posts kept; both the private (n1) and published (n2) notes are gone.
    expect(await count(exec, 'saved_post')).toBe(1);
    expect(await count(exec, 'note')).toBe(0);
    // The published post's content still lives in the surviving post_cache.
    expect(await count(exec, 'post_cache')).toBe(1);
  });
});
