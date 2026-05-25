import type { SqlExecutor } from './executor';
import type { Migration } from './migrations';
import { MIGRATIONS } from './migrations';

export interface MigrationResult {
  readonly applied: ReadonlyArray<Migration>;
  readonly alreadyApplied: ReadonlyArray<Migration>;
  /** IDs present in `schema_migrations` on disk that DON'T appear in
   *  the supplied `migrations` array. Phase-1.5 R0 deleted migration
   *  003 (`roleplay-session-extra`); a device that applied it
   *  pre-R0 still has the row. Surfaced for boot diagnostics + so a
   *  future re-numbering or rollback mistake doesn't go silent. */
  readonly unknownApplied: ReadonlyArray<number>;
}

const META_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

/**
 * Split a multi-statement SQL block into individual statements. This
 * exists because some op-sqlite versions (and historically a number
 * of other SQLite-binding shims) only run the FIRST statement of a
 * multi-statement string passed to `db.execute()`. Migrations 005 +
 * 007 + 008 are multi-statement (multiple ALTER TABLEs in one
 * migration); if the runner relied on executor multi-statement
 * support, those migrations would partially apply on device while
 * passing every Jest test (better-sqlite3 handles multi-statement
 * fine, so tests don't catch it).
 *
 * The split is on `;` followed by a newline, which is the
 * statement-terminator convention every migration in this tree
 * follows. It does NOT handle semicolons inside string literals —
 * if a future migration needs that, switch to a sqlite-tokeniser
 * split (or change Migration.sql to `string[]`).
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply every pending migration in order. Each migration is wrapped in a
 * transaction so a partial failure rolls back cleanly. Idempotent: rerunning
 * does nothing once everything is applied.
 */
export async function runMigrations(
  exec: SqlExecutor,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): Promise<MigrationResult> {
  for (const statement of splitStatements(META_TABLE_DDL)) {
    await exec.executeBatch(statement);
  }

  const rows = await exec.query<{ id: number }>('SELECT id FROM schema_migrations');
  const appliedIds = new Set(rows.map((r) => r.id));

  const sorted = [...migrations].sort((a, b) => a.id - b.id);
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] as Migration).id === (sorted[i - 1] as Migration).id) {
      throw new Error(`duplicate migration id: ${(sorted[i] as Migration).id}`);
    }
  }

  const knownIds = new Set(sorted.map((m) => m.id));
  const unknownApplied = [...appliedIds].filter((id) => !knownIds.has(id)).sort((a, b) => a - b);

  const applied: Migration[] = [];
  const alreadyApplied: Migration[] = [];

  for (const m of sorted) {
    if (appliedIds.has(m.id)) {
      alreadyApplied.push(m);
      continue;
    }
    const statements = splitStatements(m.sql);
    await exec.transaction(async () => {
      for (const statement of statements) {
        await exec.executeBatch(statement);
      }
      await exec.execute('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [m.id, m.name]);
    });
    applied.push(m);
  }

  return { applied, alreadyApplied, unknownApplied };
}
