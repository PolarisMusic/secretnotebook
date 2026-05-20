import type Database from 'better-sqlite3';

import type { SqlExecutor } from '../../src/db/executor';

/**
 * Wraps a better-sqlite3 in-memory database in the SqlExecutor interface so
 * the migration runner and any SQL helpers can be exercised in plain Node
 * without op-sqlite. SQLCipher encryption is *not* tested here — that lives
 * in Detox (sqlite3 CLI must fail to open the on-device file).
 */
export function nodeExecutor(db: Database.Database): SqlExecutor {
  return {
    async executeBatch(sql) {
      db.exec(sql);
    },
    async execute(sql, params = []) {
      db.prepare(sql).run(...(params as never[]));
    },
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as never[])) as never;
    },
    async transaction(fn) {
      db.prepare('BEGIN').run();
      try {
        const out = await fn();
        db.prepare('COMMIT').run();
        return out;
      } catch (e) {
        db.prepare('ROLLBACK').run();
        throw e;
      }
    },
  };
}
