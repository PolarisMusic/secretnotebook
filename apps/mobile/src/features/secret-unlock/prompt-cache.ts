import type { Prompt } from '@secretnotebook/shared-types';

import type { SqlExecutor } from '../../db/executor';
import { type PromptCategory } from './categories';
import { type UnlockPrompt } from './prompts';
import { sanitizeCategories } from './prompts';

/**
 * Module-level in-memory cache of the active prompt library. Populated
 * from `prompt_cache` at boot (`hydrateCacheFromDb`) and refreshed when
 * a successful server sync writes through (`replacePromptCache`). When
 * empty (cold install, sync failure), `getCachedPrompts()` returns
 * `null` and the caller falls back to the bundled list shipped with the
 * app.
 *
 * The synchronous getter is intentional: `resolvePromptText` and
 * `drawPromptKey` are called from render paths, and SQLite hops on
 * every render would be silly. The shape stays small enough (≲ a few
 * KB) that holding it in JS heap is fine.
 */
let inMemoryCache: UnlockPrompt[] | null = null;

/** Returns the cached active prompts, or null if the cache hasn't been
 *  populated this session. Callers fall back to bundled prompts. */
export function getCachedPrompts(): readonly UnlockPrompt[] | null {
  return inMemoryCache;
}

/** Test seam — drop in-memory state. Production never calls this. */
export function _resetCacheForTests(): void {
  inMemoryCache = null;
}

interface PromptCacheRow {
  key: string;
  text: string;
  categories: string;
  source_name: string | null;
  source_url: string | null;
  sponsored: number;
}

function rowToPrompt(row: PromptCacheRow): UnlockPrompt {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(row.categories);
  } catch {
    // ignore — sanitizeCategories handles a non-array gracefully
  }
  const categories: PromptCategory[] = Array.isArray(parsed)
    ? sanitizeCategories(parsed.filter((c): c is string => typeof c === 'string'))
    : [];
  return {
    key: row.key,
    text: row.text,
    categories,
    sourceName: row.source_name ?? null,
    sourceUrl: row.source_url ?? null,
    sponsored: row.sponsored === 1,
  };
}

/** Read every cached prompt row and load the in-memory cache. Safe to
 *  call on every app boot; idempotent. Returns true when at least one
 *  row was loaded (so the caller can decide whether the cache is warm). */
export async function hydrateCacheFromDb(exec: SqlExecutor): Promise<boolean> {
  const rows = await exec.query<PromptCacheRow>(
    `SELECT key, text, categories, source_name, source_url, sponsored FROM prompt_cache`,
  );
  if (rows.length === 0) {
    inMemoryCache = null;
    return false;
  }
  inMemoryCache = rows.map(rowToPrompt);
  return true;
}

/**
 * Replace the cache with a fresh server response. Atomic on the SQLite
 * side (DELETE + bulk INSERT in one txn) so a crash mid-write can't
 * leave a partial set; the in-memory cache only swaps after the txn
 * commits. `fetchedAt` is informational — surfaced through
 * `getCacheFetchedAt` for diagnostics.
 */
export async function replacePromptCache(
  exec: SqlExecutor,
  items: readonly Prompt[],
  fetchedAtSec: number,
): Promise<void> {
  await exec.transaction(async () => {
    await exec.execute(`DELETE FROM prompt_cache`);
    for (const p of items) {
      await exec.execute(
        `INSERT INTO prompt_cache (
            key, text, categories, source_name, source_url, sponsored, fetched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          p.key,
          p.text,
          JSON.stringify(p.categories),
          p.sourceName,
          p.sourceUrl,
          p.sponsored ? 1 : 0,
          fetchedAtSec,
        ],
      );
    }
  });
  inMemoryCache = items.map((p) => ({
    key: p.key,
    text: p.text,
    categories: sanitizeCategories(p.categories),
    sourceName: p.sourceName ?? null,
    sourceUrl: p.sourceUrl ?? null,
    sponsored: p.sponsored,
  }));
}

/** Latest server sync timestamp from the cache (epoch-sec), or null if
 *  the cache is empty. Used by diagnostics to surface "last refreshed". */
export async function getCacheFetchedAt(exec: SqlExecutor): Promise<number | null> {
  const rows = await exec.query<{ fetched_at: number }>(
    `SELECT MAX(fetched_at) AS fetched_at FROM prompt_cache`,
  );
  const row = rows[0];
  if (!row || row.fetched_at == null) return null;
  return row.fetched_at;
}
