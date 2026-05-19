import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { nodeExecutor } from './helpers/sqlite-executor';

const EXPECTED_TABLES = [
  'profiles',
  'couple',
  'session',
  'post_cache',
  'saved_post',
  'prompt',
  'ledger_entry',
  'roleplay_session',
  'sync_outbox',
  'sync_seen',
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

    expect(result.applied.map((m) => m.name)).toEqual(['init']);
    expect(result.alreadyApplied).toEqual([]);

    const names = tableNames(db);
    for (const t of EXPECTED_TABLES) {
      expect(names).toContain(t);
    }
    expect(names).toContain('schema_migrations');
  });

  it('is idempotent: re-running applies nothing', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    const second = await runMigrations(nodeExecutor(db), MIGRATIONS);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied.map((m) => m.name)).toEqual(['init']);
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
    const db = new Database(':memory:');
    const bad = [
      { id: 1, name: 'good', sql: 'CREATE TABLE good (id INTEGER);' },
      { id: 2, name: 'bad', sql: 'CREATE TABLE bad (id INTEGER); SELECT INVALID SQL;' },
    ];
    await expect(runMigrations(nodeExecutor(db), bad)).rejects.toThrow();

    const names = tableNames(db);
    expect(names).toContain('good');
    expect(names).not.toContain('bad');
    const recorded = db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[];
    expect(recorded.map((r) => r.id)).toEqual([1]);
  });

  it('enforces the couple.status CHECK constraint', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    expect(() =>
      db
        .prepare(
          `INSERT INTO couple (id, partner_a_pubkey, partner_b_pubkey,
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

  it('creates the indexes the runtime queries rely on', async () => {
    const db = new Database(':memory:');
    await runMigrations(nodeExecutor(db), MIGRATIONS);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'saved_post_for_pubkey_idx',
        'prompt_assigned_to_idx',
        'ledger_entry_kind_idx',
        'sync_outbox_next_attempt_idx',
      ]),
    );
  });
});
