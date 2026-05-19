import type { SqlExecutor } from './executor';
import type { Migration } from './migrations';
import { MIGRATIONS } from './migrations';

export interface MigrationResult {
  readonly applied: ReadonlyArray<Migration>;
  readonly alreadyApplied: ReadonlyArray<Migration>;
}

const META_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

/**
 * Apply every pending migration in order. Each migration is wrapped in a
 * transaction so a partial failure rolls back cleanly. Idempotent: rerunning
 * does nothing once everything is applied.
 */
export async function runMigrations(
  exec: SqlExecutor,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): Promise<MigrationResult> {
  await exec.executeBatch(META_TABLE_DDL);

  const rows = await exec.query<{ id: number }>('SELECT id FROM schema_migrations');
  const appliedIds = new Set(rows.map((r) => r.id));

  const sorted = [...migrations].sort((a, b) => a.id - b.id);
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] as Migration).id === (sorted[i - 1] as Migration).id) {
      throw new Error(`duplicate migration id: ${(sorted[i] as Migration).id}`);
    }
  }

  const applied: Migration[] = [];
  const alreadyApplied: Migration[] = [];

  for (const m of sorted) {
    if (appliedIds.has(m.id)) {
      alreadyApplied.push(m);
      continue;
    }
    await exec.transaction(async () => {
      await exec.executeBatch(m.sql);
      await exec.execute('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [m.id, m.name]);
    });
    applied.push(m);
  }

  return { applied, alreadyApplied };
}
