import { open, type DB } from '@op-engineering/op-sqlite';

import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from './executor';

export interface OpenDatabaseOptions {
  /** File name for the SQLCipher database (created in the app's data dir). */
  readonly name: string;
  /** SQLCipher master key derived from the device_master via HKDF. */
  readonly encryptionKey: Uint8Array;
}

export interface DatabaseHandle {
  readonly db: DB;
  readonly executor: SqlExecutor;
  close(): Promise<void>;
}

/**
 * Open the SQLCipher-encrypted database and wrap it in our SqlExecutor.
 * op-sqlite is built with SQLCipher when `OP_SQLITE_USE_SQLCIPHER=1` is set
 * during the iOS/Android build; the key must be supplied at first open and
 * on every subsequent open.
 */
export async function openDatabase(opts: OpenDatabaseOptions): Promise<DatabaseHandle> {
  if (opts.encryptionKey.length !== 32) {
    throw new Error('encryptionKey must be 32 bytes (derived via HKDF)');
  }
  const db = open({
    name: opts.name,
    encryptionKey: bytesToHex(opts.encryptionKey),
  });
  return { db, executor: makeExecutor(db), close: async () => db.close() };
}

export function makeExecutor(db: DB): SqlExecutor {
  return {
    async executeBatch(sql) {
      await db.execute(sql);
    },
    async execute(sql, params) {
      await db.execute(sql, params ? [...params] : undefined);
    },
    async query(sql, params) {
      const result = await db.execute(sql, params ? [...params] : undefined);
      return (result.rows ?? []) as never;
    },
    async transaction(fn) {
      await db.execute('BEGIN');
      try {
        const out = await fn();
        await db.execute('COMMIT');
        return out;
      } catch (e) {
        await db.execute('ROLLBACK');
        throw e;
      }
    },
  };
}
