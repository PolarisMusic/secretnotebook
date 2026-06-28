import type { PromptPreferenceSetOp } from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { DEFAULT_ENABLED_CATEGORIES, type PromptCategory } from './categories';
import { sanitizeCategories } from './prompts';

/**
 * Host capabilities for the local user's prompt-preference writer. Only
 * the local user's own row is written here; the partner's row arrives via
 * the projector from a `prompt_preference.set` op.
 */
export interface PromptPreferenceStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly enqueue: (op: PromptPreferenceSetOp) => Promise<void>;
  readonly now?: () => Date;
}

function nowSec(deps: { now?: () => Date }): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

/**
 * Persist the local user's selected categories and broadcast the
 * change. Idempotent on equal `updatedAt`; LWW on the projector side
 * means a stale local re-write (a late tick after a fresher partner
 * sync) cannot clobber the row.
 *
 * `sanitizeCategories` strips anything outside the live taxonomy so a
 * since-retired tag in an upgrade's stored prefs can't survive a write.
 */
export async function setMyPromptCategories(
  deps: PromptPreferenceStoreDeps,
  categories: readonly PromptCategory[],
): Promise<void> {
  const cleaned = sanitizeCategories(categories);
  const updatedAt = nowSec(deps);
  const json = JSON.stringify(cleaned);
  await deps.exec.execute(
    `INSERT INTO prompt_preference (pubkey, categories, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(pubkey) DO UPDATE
            SET categories = excluded.categories,
                updated_at = excluded.updated_at
          WHERE excluded.updated_at >= prompt_preference.updated_at`,
    [deps.selfPubkey, json, updatedAt],
  );
  await deps.enqueue({
    v: 1,
    kind: 'prompt_preference.set',
    setterPubkey: bytesToHex(deps.selfPubkey),
    categories: cleaned,
    updatedAt,
  });
}

/**
 * Read the prompt-category preferences for a pubkey. Returns a Set so the
 * caller can do membership checks cheaply, and a default permissive set
 * ("everything on") when the row is absent — the upgrade state for users
 * who have never opened Preferences. A user who explicitly opted out of
 * every category gets back an empty Set; the draw filter then falls back
 * to the `general` safety pool.
 */
export async function getPromptCategories(
  exec: SqlExecutor,
  pubkey: Uint8Array,
): Promise<Set<PromptCategory>> {
  const rows = await exec.query<{ categories: string }>(
    `SELECT categories FROM prompt_preference WHERE pubkey = ?`,
    [pubkey],
  );
  const row = rows[0];
  if (!row) return new Set(DEFAULT_ENABLED_CATEGORIES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.categories);
  } catch {
    return new Set(DEFAULT_ENABLED_CATEGORIES);
  }
  if (!Array.isArray(parsed)) return new Set(DEFAULT_ENABLED_CATEGORIES);
  const cleaned = sanitizeCategories(parsed.filter((x): x is string => typeof x === 'string'));
  return new Set(cleaned);
}
