import {
  deriveConnectionSide,
  initRatchetForConnectionSide,
  restoreRatchetState,
  snapshotRatchetState,
  type ConnectionSide,
  type RatchetState,
} from '@secretnotebook/connection-protocol';

import type { SqlExecutor } from '../../db/executor';

/**
 * Local representation of a `connection_ratchet` row. SQLite returns BLOB
 * columns as either Buffer (better-sqlite3 in Node tests) or Uint8Array
 * (op-sqlite on device) — both are unified to Uint8Array by the executor
 * wrapper but we tolerate both here just in case a future executor
 * passes raw bytes from a different driver.
 */
interface RatchetRow {
  connection_id: string;
  self_side: ConnectionSide;
  sending_chain_key: Uint8Array;
  sending_counter: number;
  receiving_chain_key: Uint8Array;
  receiving_counter: number;
  skipped_keys: Uint8Array;
  updated_at: number;
}

export interface PersistedRatchet {
  state: RatchetState;
  side: ConnectionSide;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  // op-sqlite hands BLOBs back as Uint8Array; better-sqlite3 (Node tests)
  // returns Buffer, which IS a Uint8Array, so the instanceof check catches
  // both without a hard Node typedef dependency.
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

/**
 * Persist a fresh ratchet state at pairing time. Idempotent via
 * `ON CONFLICT(connection_id) DO NOTHING` so a redundant call after a
 * successful pairing is harmless. The caller derives the side via
 * `deriveConnectionSide` and the chain keys via `initRatchetForConnectionSide`
 * — this function only writes.
 */
export async function saveInitialRatchet(
  exec: SqlExecutor,
  args: { connectionId: string; side: ConnectionSide; state: RatchetState },
  now: () => number = Date.now,
): Promise<void> {
  const snap = snapshotRatchetState(args.state);
  await exec.execute(
    `INSERT INTO connection_ratchet (
       connection_id, self_side, sending_chain_key, sending_counter,
       receiving_chain_key, receiving_counter, skipped_keys, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connection_id) DO NOTHING`,
    [
      args.connectionId,
      args.side,
      snap.sendingChainKey,
      snap.sendingCounter,
      snap.receivingChainKey,
      snap.receivingCounter,
      snap.skippedKeysBlob,
      Math.floor(now() / 1000),
    ],
  );
}

/**
 * Write the post-encrypt or post-decrypt ratchet state back. UPDATE-only
 * (no INSERT): if there's no row for this connection, something's wrong with
 * the boot pipeline and we'd rather fail loudly than ratchet into the
 * void.
 */
export async function saveRatchet(
  exec: SqlExecutor,
  connectionId: string,
  state: RatchetState,
  now: () => number = Date.now,
): Promise<void> {
  const snap = snapshotRatchetState(state);
  await exec.execute(
    `UPDATE connection_ratchet
        SET sending_chain_key   = ?,
            sending_counter     = ?,
            receiving_chain_key = ?,
            receiving_counter   = ?,
            skipped_keys        = ?,
            updated_at          = ?
      WHERE connection_id = ?`,
    [
      snap.sendingChainKey,
      snap.sendingCounter,
      snap.receivingChainKey,
      snap.receivingCounter,
      snap.skippedKeysBlob,
      Math.floor(now() / 1000),
      connectionId,
    ],
  );
}

export async function loadRatchet(
  exec: SqlExecutor,
  connectionId: string,
): Promise<PersistedRatchet | null> {
  const rows = await exec.query<RatchetRow>(
    `SELECT connection_id, self_side, sending_chain_key, sending_counter,
            receiving_chain_key, receiving_counter, skipped_keys, updated_at
       FROM connection_ratchet WHERE connection_id = ?`,
    [connectionId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    side: row.self_side,
    state: restoreRatchetState({
      sendingChainKey: bytesFromRow(row.sending_chain_key),
      sendingCounter: row.sending_counter,
      receivingChainKey: bytesFromRow(row.receiving_chain_key),
      receivingCounter: row.receiving_counter,
      skippedKeysBlob: bytesFromRow(row.skipped_keys),
    }),
  };
}

/**
 * One-shot pairing-time helper: derive the connection side from the two
 * pubkeys, initialise the ratchet from the root key, persist the row.
 * Returns the in-memory state + side so the caller can use them
 * immediately without a re-load.
 */
export async function initAndSaveRatchet(
  exec: SqlExecutor,
  args: {
    connectionId: string;
    rootKey: Uint8Array;
    selfPub: Uint8Array;
    peerPub: Uint8Array;
  },
  now: () => number = Date.now,
): Promise<PersistedRatchet> {
  const side = deriveConnectionSide({ selfPub: args.selfPub, peerPub: args.peerPub });
  const state = await initRatchetForConnectionSide(args.rootKey, side);
  await saveInitialRatchet(exec, { connectionId: args.connectionId, side, state }, now);
  return { side, state };
}
