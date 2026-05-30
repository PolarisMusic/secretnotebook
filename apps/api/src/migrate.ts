import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { loadEnv } from './config.js';

/**
 * Minimal idempotent SQL migration runner. Walks
 * `infra/db/migrations/*.sql` in lexicographic order, applying each
 * file inside its own transaction. Tracks applied migrations in a
 * `schema_migrations(filename, applied_at)` table so re-runs are
 * no-ops.
 *
 * Why hand-rolled instead of Drizzle's migrate(): the existing SQL
 * files are plain DDL (not Drizzle-generated journals), and the
 * service boots from a Docker image that needs migrations to run
 * before `start`. Wiring drizzle-kit at build time would pull a
 * dev dep into the runtime image; this stays small.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is required to run migrations');
    process.exit(1);
  }

  // Locate the migrations dir. In the Docker image the repo root is
  // /repo and migrations live at /repo/infra/db/migrations; in local
  // dev they resolve relative to this file.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../infra/db/migrations'),
    resolve(here, '../../infra/db/migrations'),
    '/repo/infra/db/migrations',
  ];
  let migrationsDir: string | null = null;
  for (const c of candidates) {
    try {
      readdirSync(c);
      migrationsDir = c;
      break;
    } catch {
      // try next
    }
  }
  if (!migrationsDir) {
    console.error('migrate: could not locate infra/db/migrations', candidates);
    process.exit(1);
  }

  const files = readdirSync(migrationsDir)
    .filter((n) => n.endsWith('.sql'))
    .sort();

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const applied = new Set<string>(
      (await pool.query<{ filename: string }>(`SELECT filename FROM schema_migrations`)).rows.map(
        (r) => r.filename,
      ),
    );

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`migrate: skip ${filename} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, filename), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [filename]);
        await client.query('COMMIT');
        console.log(`migrate: applied ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

void main();
