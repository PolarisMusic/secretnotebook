import { and, asc, eq, isNull } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { prompts } from '../db/schema.js';
import type { NewPromptInput, PromptPatch, PromptsStore, StoredPrompt } from './types.js';

function toStored(r: typeof prompts.$inferSelect): StoredPrompt {
  return {
    key: r.key,
    text: r.text,
    categories: r.categories ?? [],
    sourceName: r.sourceName ?? null,
    sourceUrl: r.sourceUrl ?? null,
    sponsored: r.sponsored,
    retiredAt: r.retiredAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class DrizzlePromptsStore implements PromptsStore {
  constructor(private readonly db: Database) {}

  async listActive(): Promise<StoredPrompt[]> {
    const rows = await this.db
      .select()
      .from(prompts)
      .where(isNull(prompts.retiredAt))
      .orderBy(asc(prompts.key));
    return rows.map(toStored);
  }

  async listAll(): Promise<StoredPrompt[]> {
    const rows = await this.db.select().from(prompts).orderBy(asc(prompts.key));
    return rows.map(toStored);
  }

  async findByKey(key: string): Promise<StoredPrompt | null> {
    const rows = await this.db.select().from(prompts).where(eq(prompts.key, key)).limit(1);
    const row = rows[0];
    return row ? toStored(row) : null;
  }

  async create(input: NewPromptInput, now: Date): Promise<StoredPrompt> {
    const inserted = await this.db
      .insert(prompts)
      .values({
        key: input.key,
        text: input.text,
        categories: input.categories,
        sourceName: input.sourceName ?? null,
        sourceUrl: input.sourceUrl ?? null,
        sponsored: input.sponsored ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('DrizzlePromptsStore.create: insert returned no row');
    return toStored(row);
  }

  async update(key: string, patch: PromptPatch, now: Date): Promise<StoredPrompt | null> {
    const updates: Record<string, unknown> = { updatedAt: now };
    if (patch.text !== undefined) updates.text = patch.text;
    if (patch.categories !== undefined) updates.categories = patch.categories;
    if (patch.sourceName !== undefined) updates.sourceName = patch.sourceName;
    if (patch.sourceUrl !== undefined) updates.sourceUrl = patch.sourceUrl;
    if (patch.sponsored !== undefined) updates.sponsored = patch.sponsored;
    const updated = await this.db
      .update(prompts)
      .set(updates)
      .where(eq(prompts.key, key))
      .returning();
    const row = updated[0];
    return row ? toStored(row) : null;
  }

  async retire(key: string, now: Date): Promise<boolean> {
    const updated = await this.db
      .update(prompts)
      .set({ retiredAt: now, updatedAt: now })
      .where(and(eq(prompts.key, key), isNull(prompts.retiredAt)))
      .returning({ key: prompts.key });
    return updated.length > 0;
  }

  async unretire(key: string, now: Date): Promise<boolean> {
    // Filtering on retiredAt IS NOT NULL via drizzle: there's no isNotNull
    // helper export; using a raw NOT NULL check would need sql template.
    // Two-step is fine — a no-op retire->unretire race is benign (idempotent).
    const row = await this.findByKey(key);
    if (!row || row.retiredAt == null) return false;
    await this.db
      .update(prompts)
      .set({ retiredAt: null, updatedAt: now })
      .where(eq(prompts.key, key));
    return true;
  }
}
