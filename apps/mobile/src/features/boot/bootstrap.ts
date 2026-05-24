import type { Ed25519KeyPair } from '@secretnotebook/crypto';
import type { SqlExecutor } from '../../db/executor';
import { deriveDeviceSigningKey } from '../api/device-key';
import { getOrCreateDeviceMaster, type RandomBytes } from '../../security/device-master';
import type { KeychainAdapter } from '../../security/keychain';
import { deriveSqlcipherKey } from '../../security/sqlcipher-key';
import { type ActiveConnection, loadActiveConnection } from './connection-load';

/**
 * Pure boot pipeline — no React, no globals. Dependencies are injected so
 * the test suite can drive it with better-sqlite3 + an in-memory keychain.
 * Production wiring lives in run.ts and supplies real implementations.
 *
 * Steps (each can fail; the caller surfaces the message verbatim):
 *   1. load (or create) the 32-byte device_master from the keychain
 *      — first launch generates fresh bytes via libsodium and seals the
 *      keychain entry behind biometric. Subsequent launches trigger the
 *      biometric prompt as a side-effect of the keychain read.
 *   2. HKDF-derive the 32-byte SQLCipher master key from device_master.
 *   3. open the encrypted database (op-sqlite + SQLCipher on device).
 *   4. apply any pending migrations idempotently.
 *   5. read the single Phase-1 connection row (if any) so the navigator can
 *      pick the right phase on first render.
 */
export interface OpenDatabaseResult {
  readonly executor: SqlExecutor;
}

export interface BootDeps {
  readonly keychain: KeychainAdapter;
  readonly randomBytes?: RandomBytes;
  /** Open the SQLCipher database with the supplied 32-byte key. */
  readonly openDatabase: (encryptionKey: Uint8Array) => Promise<OpenDatabaseResult>;
  /** Apply any pending migrations against the open executor. */
  readonly runMigrations: (exec: SqlExecutor) => Promise<void>;
}

export interface BootResult {
  readonly executor: SqlExecutor;
  readonly connection: ActiveConnection | null;
  readonly deviceSigningKey: Ed25519KeyPair;
}

export async function bootstrap(deps: BootDeps): Promise<BootResult> {
  const deviceMaster = await getOrCreateDeviceMaster(deps.keychain, deps.randomBytes);
  const sqlcipherKey = await deriveSqlcipherKey(deviceMaster);
  const { executor } = await deps.openDatabase(sqlcipherKey);
  await deps.runMigrations(executor);
  const connection = await loadActiveConnection(executor);
  const deviceSigningKey = await deriveDeviceSigningKey(deviceMaster);
  return { executor, connection, deviceSigningKey };
}
