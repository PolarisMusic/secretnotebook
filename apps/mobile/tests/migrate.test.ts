import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import type { SqlExecutor } from '../src/db/executor';
import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { nodeExecutor } from './helpers/sqlite-executor';

const EXPECTED_TABLES = [
  'profiles',
  'connection',
  'session',
  'post_cache',
  'saved_post',
  'prompt',
  'ledger_entry',
  'sync_outbox',
  'sync_seen',
  'connection_ratchet',
  'app_setting',
  'safeword_trigger',
  'secret_unlock',
  'secret_unlock_reflection',
  'hidden_post',
  'pending_note',
];

function tableNames(db: Database.Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);
}

describe('runMigrations', () => {
  it('creates every Phase-1 table on a fresh database', async () => {
    const db = new Database(':memory:');
    const result = await runMigrations(nodeExecutor(db), MIGRATIONS);

    expect(result.applied.map((m) => m.name)).toEqual([
      'init',
      'connection-ratchet',
      'drop-couple-loop',
      'rename-couple-to-connection',
      'notes',
      'note-publish-cols',
      'connection-roles',
      'entitlement',
      'app-settings',
      'paired-coercion',
      'safeword-term',
      'post-audience',
      'attachments',
      'secret-unlock',
      'sever-grace',
      'hidden-posts',
      'pending-notes',
      'note-edit-delete',
    ]);
    expect(result.alreadyApplied).toEqual([]);

    const names = tableNames(db);
    for (const t of EXPECTED_TABLES) {
      expect(names).toContain(t);
    }
    expect(names).toContain('schema_migrations');
    // Phase-1.5 R0 dropped this table — confirm it's gone.
    expect(names).not.toContain('roleplay_session');
    // Phase-1.5 R1 renamed couple → connection — confirm both
    // pre-rename names are gone.
    expect(names).not.toContain('couple');
    expect(names).not.toContain('couple_ratchet');
    // Phase-1.5 R2 added the notes carrier.
    expect(names).toContain('note');
  });

  it('is idempotent: re-running applies nothing', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    const second = await runMigrations(nodeExecutor(db), MIGRATIONS);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied.map((m) => m.name)).toEqual([
      'init',
      'connection-ratchet',
      'drop-couple-loop',
      'rename-couple-to-connection',
      'notes',
      'note-publish-cols',
      'connection-roles',
      'entitlement',
      'app-settings',
      'paired-coercion',
      'safeword-term',
      'post-audience',
      'attachments',
      'secret-unlock',
      'sever-grace',
      'hidden-posts',
      'pending-notes',
      'note-edit-delete',
    ]);
  });

  it('rejects duplicate migration ids', async () => {
    const db = new Database(':memory:');
    const dupes = [
      { id: 1, name: 'a', sql: 'SELECT 1;' },
      { id: 1, name: 'b', sql: 'SELECT 1;' },
    ];
    await expect(runMigrations(nodeExecutor(db), dupes)).rejects.toThrow(/duplicate/);
  });

  it('rolls back a failed migration so the schema is unchanged', async () => {
    // We test the runner's rollback semantics — not the SQLite parser.
    // Earlier sentinel SQL ("NOT_A_VALID_STATEMENT;", "INSERT INTO
    // never_existed ...") threw locally but the prebuilt better-sqlite3
    // binary on the CI runner sometimes did not surface either error
    // through db.exec's multi-statement path. We control the failure
    // point directly with a wrapper executor that throws when the
    // runner asks it to apply the second migration. The first
    // migration's tables and the rolled-back state are still
    // exercised against real better-sqlite3.
    const db = new Database(':memory:');
    const real = nodeExecutor(db);
    let migrationBatches = 0;
    const exec: SqlExecutor = {
      ...real,
      async executeBatch(sql) {
        // Call sequence inside runMigrations is:
        //   1. META_TABLE_DDL (schema_migrations creation)
        //   2. migration 1 SQL (inside transaction)
        //   3. migration 2 SQL (inside transaction) — throw here
        migrationBatches++;
        if (migrationBatches === 3) throw new Error('synthetic migration failure');
        return real.executeBatch(sql);
      },
    };
    const bad = [
      { id: 1, name: 'good', sql: 'CREATE TABLE good (id INTEGER);' },
      { id: 2, name: 'bad', sql: 'CREATE TABLE bad (id INTEGER);' },
    ];

    await expect(runMigrations(exec, bad)).rejects.toThrow(/synthetic migration failure/);

    const names = tableNames(db);
    expect(names).toContain('good'); // migration 1 applied + committed
    expect(names).not.toContain('bad'); // migration 2 rolled back
    const recorded = db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[];
    expect(recorded.map((r) => r.id)).toEqual([1]);
  });

  it('enforces the connection.status CHECK constraint', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    expect(() =>
      db
        .prepare(
          `INSERT INTO connection (id, partner_a_pubkey, partner_b_pubkey,
              channel_root_key_wrapped, paired_at, status)
           VALUES ('c', X'01', X'02', X'03', 0, 'gibberish')`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('enforces the prompt.state CHECK constraint', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    expect(() =>
      db
        .prepare(
          `INSERT INTO prompt (id, library_key, title, body,
              assigned_to_pubkey, assigned_by_pubkey, state)
           VALUES ('p', 'k', 't', 'b', X'01', X'02', 'nope')`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('enforces the ledger_entry.kind CHECK (couple_points only in Phase 1)', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    expect(() =>
      db
        .prepare(
          `INSERT INTO ledger_entry (id, kind, delta, reason)
           VALUES ('l', 'popularity_points', 1, 'unused')`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('enforces the secret_unlock.state CHECK constraint', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    expect(() =>
      db
        .prepare(
          `INSERT INTO secret_unlock (id, author_pubkey, unlocker_pubkey,
              prompt_key, state, created_at)
           VALUES ('u', X'01', X'02', 'k', 'bogus', 0)`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('creates the indexes the runtime queries rely on', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'prompt_assigned_to_idx',
        'ledger_entry_kind_idx',
        'sync_outbox_next_attempt_idx',
        'safeword_trigger_active_idx',
        'secret_unlock_author_idx',
        'secret_unlock_unlocker_idx',
      ]),
    );
    // Phase-1.5 R0 dropped this index along with the unlocked_at column.
    expect(indexes).not.toContain('saved_post_for_pubkey_idx');
  });

  it('reports unknown applied ids — surfaces rows from migrations the array no longer carries', async () => {
    // Simulates the "device upgraded across R0 with id=3 still in
    // schema_migrations" case. The runner doesn't error (extra
    // applied rows are valid: a migration could have been deleted
    // because its effect was later dropped by a successor), but
    // surfaces the gap so boot diagnostics + Sentry breadcrumbs
    // can record it.
    const db = new Database(':memory:');
    const exec = nodeExecutor(db);
    await runMigrations(exec, MIGRATIONS);
    // Sneak a row for an id we don't ship.
    db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(3, 'unknown-extra');

    const re = await runMigrations(exec, MIGRATIONS);
    expect(re.applied).toEqual([]);
    expect(re.unknownApplied).toEqual([3]);
  });

  it('returns unknownApplied=[] when every applied id is known', async () => {
    const db = new Database(':memory:');
    const exec = nodeExecutor(db);
    const first = await runMigrations(exec, MIGRATIONS);
    expect(first.unknownApplied).toEqual([]);
  });
});
