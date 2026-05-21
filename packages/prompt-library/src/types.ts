import { z } from 'zod';

/**
 * Suggested assignee — a hint only, the assigner is free to ignore it.
 *   - 'either':  works regardless of who's doing it
 *   - 'curator': suits the partner not initiating the loop (the watcher)
 *   - 'enactor': suits the partner who'll perform / lead the activity
 */
export const SuggestedAssigneeSchema = z.enum(['either', 'curator', 'enactor']);
export type SuggestedAssignee = z.infer<typeof SuggestedAssigneeSchema>;

export const PromptSchema = z.object({
  /** Stable identifier referenced by `prompt.library_key`. Kebab-case. */
  key: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z][a-z0-9-]*$/, 'must be lowercase kebab-case'),
  title: z.string().min(3).max(80),
  body: z.string().min(10).max(400),
  suggestedAssignee: SuggestedAssigneeSchema,
  /** Optional categorisation, mostly for future surfacing. Open-ended. */
  tags: z.array(z.string().min(1).max(30)).default([]),
});
export type Prompt = z.infer<typeof PromptSchema>;

export const PromptLibrarySchema = z.object({
  version: z.literal(1),
  prompts: z.array(PromptSchema).min(1),
});
export type PromptLibrary = z.infer<typeof PromptLibrarySchema>;
