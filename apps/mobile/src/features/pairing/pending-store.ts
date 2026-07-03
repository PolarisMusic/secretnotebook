import type { SqlExecutor } from '../../db/executor';
import { getAppSetting, setAppSetting } from '../settings/store';

/**
 * Remembers the initiator's in-flight rendezvous code so a shared-code
 * pairing can span a background/kill: the server keeps the code for 24h, and
 * this lets the app resume waiting on it when the pairing screen reopens
 * within that window instead of forcing a fresh code. Device-local (no sync,
 * no partner). Only the code + deadline are stored — never any key material.
 */
const PENDING_PAIRING_KEY = 'pending_pairing';

export interface PendingPairing {
  readonly code: string;
  /** Unix ms after which the code is dead (server TTL has passed). */
  readonly deadline: number;
}

export async function setPendingPairing(exec: SqlExecutor, pending: PendingPairing): Promise<void> {
  await setAppSetting(exec, PENDING_PAIRING_KEY, JSON.stringify(pending));
}

export async function clearPendingPairing(exec: SqlExecutor): Promise<void> {
  await setAppSetting(exec, PENDING_PAIRING_KEY, '');
}

/** The stored pending pairing if one exists and hasn't expired, else null.
 *  Expired entries are cleared as a side effect. */
export async function getPendingPairing(
  exec: SqlExecutor,
  now: number = Date.now(),
): Promise<PendingPairing | null> {
  const raw = await getAppSetting(exec, PENDING_PAIRING_KEY);
  if (raw == null || raw.length === 0) return null;
  let parsed: Partial<PendingPairing>;
  try {
    parsed = JSON.parse(raw) as Partial<PendingPairing>;
  } catch {
    return null;
  }
  if (typeof parsed.code !== 'string' || typeof parsed.deadline !== 'number') return null;
  if (parsed.deadline <= now) {
    await clearPendingPairing(exec);
    return null;
  }
  return { code: parsed.code, deadline: parsed.deadline };
}
