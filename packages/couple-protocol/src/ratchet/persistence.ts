import { MAX_SKIPPED_MESSAGE_KEYS, type RatchetState } from './types.js';

/**
 * Wire layout for a serialised skipped-key cache:
 *   byte 0:        version (currently 1)
 *   bytes 1..2:    BE uint16 count
 *   then `count` entries, each:
 *     bytes 0..3:  BE uint32 counter
 *     bytes 4..35: 32-byte message key
 *
 * Total size: 3 + 36 * count, capped at 3 + 36 * 1000 = 36 003 bytes.
 *
 * Versioned so we can swap the layout if/when the DH ratchet lands.
 */
const SKIPPED_KEYS_VERSION = 1;
const SKIPPED_KEY_BYTES = 32;
const SKIPPED_ENTRY_BYTES = 4 + SKIPPED_KEY_BYTES; // counter + key

export function serialiseSkippedKeys(skipped: ReadonlyMap<number, Uint8Array>): Uint8Array {
  if (skipped.size > MAX_SKIPPED_MESSAGE_KEYS) {
    throw new Error(`skipped-key cache (${skipped.size}) exceeds the protocol limit`);
  }
  // Sort by counter for a deterministic byte layout — makes the BLOB
  // diff-able across saves and gives a stable hash if we ever want one.
  const entries = [...skipped.entries()].sort((x, y) => x[0] - y[0]);
  const out = new Uint8Array(3 + entries.length * SKIPPED_ENTRY_BYTES);
  out[0] = SKIPPED_KEYS_VERSION;
  out[1] = (entries.length >>> 8) & 0xff;
  out[2] = entries.length & 0xff;
  let off = 3;
  for (const [counter, key] of entries) {
    if (!Number.isInteger(counter) || counter < 0 || counter > 0xff_ff_ff_ff) {
      throw new Error(`skipped-key counter out of range: ${counter}`);
    }
    if (key.length !== SKIPPED_KEY_BYTES) {
      throw new Error(`skipped-key must be ${SKIPPED_KEY_BYTES} bytes, got ${key.length}`);
    }
    out[off] = (counter >>> 24) & 0xff;
    out[off + 1] = (counter >>> 16) & 0xff;
    out[off + 2] = (counter >>> 8) & 0xff;
    out[off + 3] = counter & 0xff;
    out.set(key, off + 4);
    off += SKIPPED_ENTRY_BYTES;
  }
  return out;
}

export function deserialiseSkippedKeys(bytes: Uint8Array): Map<number, Uint8Array> {
  if (bytes.length < 3) {
    throw new Error(`skipped-keys blob too short: ${bytes.length} bytes`);
  }
  const version = bytes[0]!;
  if (version !== SKIPPED_KEYS_VERSION) {
    throw new Error(`skipped-keys: unsupported version ${version}`);
  }
  const count = ((bytes[1]! << 8) | bytes[2]!) >>> 0;
  if (count > MAX_SKIPPED_MESSAGE_KEYS) {
    throw new Error(`skipped-keys: declared count ${count} exceeds protocol limit`);
  }
  const expected = 3 + count * SKIPPED_ENTRY_BYTES;
  if (bytes.length !== expected) {
    throw new Error(
      `skipped-keys: expected ${expected} bytes for ${count} entries, got ${bytes.length}`,
    );
  }
  const out = new Map<number, Uint8Array>();
  let off = 3;
  for (let i = 0; i < count; i++) {
    const counter =
      ((bytes[off]! << 24) | (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!) >>>
      0;
    const key = bytes.slice(off + 4, off + 4 + SKIPPED_KEY_BYTES);
    if (out.has(counter)) {
      throw new Error(`skipped-keys: duplicate counter ${counter}`);
    }
    out.set(counter, key);
    off += SKIPPED_ENTRY_BYTES;
  }
  return out;
}

/**
 * Plain-data snapshot of the in-memory ratchet state, in the shape the
 * mobile SQLite layer stores it in (chain keys + counters as columns +
 * skipped-keys as a single BLOB). Couple-protocol stays free of any
 * persistence concern.
 */
export interface RatchetStateSnapshot {
  sendingChainKey: Uint8Array;
  sendingCounter: number;
  receivingChainKey: Uint8Array;
  receivingCounter: number;
  skippedKeysBlob: Uint8Array;
}

export function snapshotRatchetState(state: RatchetState): RatchetStateSnapshot {
  return {
    sendingChainKey: state.sendingChainKey,
    sendingCounter: state.sendingCounter,
    receivingChainKey: state.receivingChainKey,
    receivingCounter: state.receivingCounter,
    skippedKeysBlob: serialiseSkippedKeys(state.skipped),
  };
}

export function restoreRatchetState(snapshot: RatchetStateSnapshot): RatchetState {
  if (snapshot.sendingChainKey.length !== 32) {
    throw new Error('sendingChainKey must be 32 bytes');
  }
  if (snapshot.receivingChainKey.length !== 32) {
    throw new Error('receivingChainKey must be 32 bytes');
  }
  if (
    !Number.isInteger(snapshot.sendingCounter) ||
    snapshot.sendingCounter < 0 ||
    snapshot.sendingCounter > 0xff_ff_ff_ff
  ) {
    throw new Error(`sendingCounter out of range: ${snapshot.sendingCounter}`);
  }
  if (
    !Number.isInteger(snapshot.receivingCounter) ||
    snapshot.receivingCounter < 0 ||
    snapshot.receivingCounter > 0xff_ff_ff_ff
  ) {
    throw new Error(`receivingCounter out of range: ${snapshot.receivingCounter}`);
  }
  return {
    sendingChainKey: snapshot.sendingChainKey,
    sendingCounter: snapshot.sendingCounter,
    receivingChainKey: snapshot.receivingChainKey,
    receivingCounter: snapshot.receivingCounter,
    skipped: deserialiseSkippedKeys(snapshot.skippedKeysBlob),
  };
}
