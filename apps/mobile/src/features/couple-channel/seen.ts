import { sha256 } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

/**
 * Dedup key for an inbound envelope. We hash `header || ciphertext` so
 * the marker is content-bound — replays of the same bytes resolve to the
 * same key regardless of the relay-side row id. Saves a `BLOB PRIMARY KEY`
 * in `sync_seen`.
 */
export async function envelopeHash(
  header: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const combined = new Uint8Array(header.length + ciphertext.length);
  combined.set(header, 0);
  combined.set(ciphertext, header.length);
  return sha256(combined);
}

export async function isEnvelopeSeen(exec: SqlExecutor, hash: Uint8Array): Promise<boolean> {
  const rows = await exec.query<{ one: number }>(
    'SELECT 1 AS one FROM sync_seen WHERE envelope_hash = ? LIMIT 1',
    [hash],
  );
  return rows.length > 0;
}

export async function markEnvelopeSeen(exec: SqlExecutor, hash: Uint8Array): Promise<void> {
  await exec.execute('INSERT OR IGNORE INTO sync_seen (envelope_hash) VALUES (?)', [hash]);
}
