import { z } from 'zod';

/** Cap on prompt body — small enough to keep the wire compact, big enough
 *  for a paragraph. The admin form enforces this; the mobile renderer
 *  doesn't truncate, so anything that fits the cap renders cleanly. */
export const PROMPT_TEXT_MAX = 600;

/** Per-key max for category strings. Matches the mobile category-key
 *  rules (snake-case alphanumerics; the longest shipped is
 *  `raising_toddlers` at 16 chars). */
export const PROMPT_CATEGORY_KEY_MAX = 40;

/** Stable identifier mobile ops carry. Once a key has shipped it must
 *  keep resolving — admins can't rename, only retire. Snake-case ASCII
 *  to keep it readable in op payloads + admin UI. */
export const PromptKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, 'must be snake_case ASCII');

export const PromptCategoryKeySchema = z
  .string()
  .min(1)
  .max(PROMPT_CATEGORY_KEY_MAX)
  .regex(/^[a-z0-9_]+$/, 'must be snake_case ASCII');

/**
 * Wire shape for one prompt on the public `/v1/prompts` fetch path.
 * Mobile caches these rows into its `prompt_cache` table and reads them
 * at draw time. Source attribution is optional (null when the prompt
 * isn't externally-sourced); `sponsored` defaults to false.
 */
export const PromptSchema = z.object({
  key: PromptKeySchema,
  text: z.string().min(1).max(PROMPT_TEXT_MAX),
  categories: z.array(PromptCategoryKeySchema).max(64),
  sourceName: z.string().min(1).max(120).nullable(),
  sourceUrl: z.string().url().max(2048).nullable(),
  sponsored: z.boolean(),
});
export type Prompt = z.infer<typeof PromptSchema>;

export const PromptListResponseSchema = z.object({
  items: z.array(PromptSchema),
  /** Server-clock time the response was generated. Mobile uses this as
   *  the "last refreshed" stamp — purely informational. */
  fetchedAt: z.string().datetime(),
});
export type PromptListResponse = z.infer<typeof PromptListResponseSchema>;

/**
 * Admin-only payload to create a prompt. Same shape as the wire prompt
 * minus the system-controlled fields; the key is provided by the admin
 * because it must be human-meaningful + stable across the lifetime of
 * any op that references it.
 */
export const AdminPromptCreateSchema = z.object({
  key: PromptKeySchema,
  text: z.string().min(1).max(PROMPT_TEXT_MAX),
  categories: z.array(PromptCategoryKeySchema).min(1).max(64),
  sourceName: z.string().min(1).max(120).nullable().optional(),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  sponsored: z.boolean().optional(),
});
export type AdminPromptCreate = z.infer<typeof AdminPromptCreateSchema>;

/** Patch payload — every field optional; the admin can edit any subset. */
export const AdminPromptPatchSchema = z
  .object({
    text: z.string().min(1).max(PROMPT_TEXT_MAX).optional(),
    categories: z.array(PromptCategoryKeySchema).min(1).max(64).optional(),
    sourceName: z.string().min(1).max(120).nullable().optional(),
    sourceUrl: z.string().url().max(2048).nullable().optional(),
    sponsored: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'patch must include at least one field' });
export type AdminPromptPatch = z.infer<typeof AdminPromptPatchSchema>;

/**
 * Admin row shape — adds the system-controlled fields the admin list
 * needs to surface (retired status, timestamps).
 */
export const AdminPromptRowSchema = PromptSchema.extend({
  retiredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminPromptRow = z.infer<typeof AdminPromptRowSchema>;

export const AdminPromptListResponseSchema = z.object({
  items: z.array(AdminPromptRowSchema),
});
export type AdminPromptListResponse = z.infer<typeof AdminPromptListResponseSchema>;
