import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import {
  _resetCacheForTests,
  getCachedPrompts,
  getCacheFetchedAt,
  hydrateCacheFromDb,
  replacePromptCache,
} from '../src/features/secret-unlock/prompt-cache';
import {
  drawPromptKey,
  findPrompt,
  resolvePromptText,
} from '../src/features/secret-unlock/prompts';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshExec(): Promise<SqlExecutor> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return exec;
}

describe('prompt-cache', () => {
  beforeEach(() => {
    _resetCacheForTests();
  });
  afterEach(() => {
    _resetCacheForTests();
  });

  describe('hydrateCacheFromDb', () => {
    it('returns false and leaves the cache null on an empty table', async () => {
      const exec = await freshExec();
      const warm = await hydrateCacheFromDb(exec);
      expect(warm).toBe(false);
      expect(getCachedPrompts()).toBeNull();
    });

    it('hydrates the in-memory cache after replacePromptCache writes rows', async () => {
      const exec = await freshExec();
      await replacePromptCache(
        exec,
        [
          {
            key: 'pq_test',
            text: 'hello world',
            categories: ['general', 'dating'],
            sourceName: 'Test Source',
            sourceUrl: 'https://example.com',
            sponsored: false,
          },
        ],
        1_700_000_000,
      );
      expect(getCachedPrompts()).not.toBeNull();
      expect(getCachedPrompts()).toHaveLength(1);
      expect(getCachedPrompts()?.[0]?.key).toBe('pq_test');
      // Reset and re-hydrate to confirm rows survive a fresh session.
      _resetCacheForTests();
      expect(getCachedPrompts()).toBeNull();
      const warm = await hydrateCacheFromDb(exec);
      expect(warm).toBe(true);
      expect(getCachedPrompts()?.[0]?.text).toBe('hello world');
      expect(getCachedPrompts()?.[0]?.sourceName).toBe('Test Source');
    });

    it('strips unknown category strings when reading from disk', async () => {
      const exec = await freshExec();
      await exec.execute(
        `INSERT INTO prompt_cache (key, text, categories, source_name, source_url, sponsored, fetched_at)
         VALUES (?, ?, ?, NULL, NULL, 0, ?)`,
        [
          'pq_legacy',
          'has retired tag',
          JSON.stringify(['dating', 'retired_thing']),
          1_700_000_000,
        ],
      );
      await hydrateCacheFromDb(exec);
      const cat = getCachedPrompts()?.[0]?.categories ?? [];
      expect([...cat]).toEqual(['dating']);
    });
  });

  describe('replacePromptCache', () => {
    it('replaces the row set atomically — a follow-up write drops absent keys', async () => {
      const exec = await freshExec();
      await replacePromptCache(
        exec,
        [
          {
            key: 'pq_a',
            text: 'A',
            categories: ['general'],
            sourceName: null,
            sourceUrl: null,
            sponsored: false,
          },
          {
            key: 'pq_b',
            text: 'B',
            categories: ['general'],
            sourceName: null,
            sourceUrl: null,
            sponsored: false,
          },
        ],
        1_700_000_000,
      );
      expect(getCachedPrompts()).toHaveLength(2);
      await replacePromptCache(
        exec,
        [
          {
            key: 'pq_a',
            text: 'A2',
            categories: ['general'],
            sourceName: null,
            sourceUrl: null,
            sponsored: false,
          },
        ],
        1_700_000_100,
      );
      expect(getCachedPrompts()).toHaveLength(1);
      expect(getCachedPrompts()?.[0]?.text).toBe('A2');
      expect(await getCacheFetchedAt(exec)).toBe(1_700_000_100);
    });
  });

  describe('integration with prompts.ts', () => {
    it('resolvePromptText prefers a cached row over the bundled list', async () => {
      const exec = await freshExec();
      await replacePromptCache(
        exec,
        [
          {
            key: 'pq_unhurried_walk',
            text: 'Server-overridden walk text',
            categories: ['general'],
            sourceName: null,
            sourceUrl: null,
            sponsored: false,
          },
        ],
        1_700_000_000,
      );
      expect(resolvePromptText('pq_unhurried_walk')).toBe('Server-overridden walk text');
    });

    it('falls back to the bundled list when the cache is empty', () => {
      expect(getCachedPrompts()).toBeNull();
      // pq_unhurried_walk is in the bundled list.
      expect(resolvePromptText('pq_unhurried_walk')).toContain('walk');
    });

    it('falls back to the bundled list for a key the cache does not have', async () => {
      const exec = await freshExec();
      await replacePromptCache(
        exec,
        [
          {
            key: 'pq_server_only',
            text: 'server only',
            categories: ['general'],
            sourceName: null,
            sourceUrl: null,
            sponsored: false,
          },
        ],
        1_700_000_000,
      );
      // Bundled key not in the cache — resolver should still find the bundled text.
      const bundledHit = findPrompt('pq_unhurried_walk');
      expect(bundledHit).not.toBeNull();
      expect(bundledHit?.text).toContain('walk');
    });

    it('drawPromptKey honours the cached pool when filters match', async () => {
      const exec = await freshExec();
      await replacePromptCache(
        exec,
        [
          {
            key: 'pq_dating_only',
            text: 'Dating-only test prompt',
            categories: ['dating'],
            sourceName: null,
            sourceUrl: null,
            sponsored: false,
          },
        ],
        1_700_000_000,
      );
      const key = drawPromptKey(() => 0, { self: new Set(['dating']), peer: new Set(['dating']) });
      expect(key).toBe('pq_dating_only');
    });
  });
});
