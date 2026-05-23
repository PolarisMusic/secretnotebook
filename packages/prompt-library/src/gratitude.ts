import gratitudeSeed from './gratitude.json';
import { PromptLibrarySchema, type Prompt } from './types.js';

/**
 * Separate library of gratitude-flavoured prompts surfaced at the end
 * of a role-play loop (S8). Same shape as the main library so the
 * picker works against either set; lives in a separate JSON because
 * (a) the assigner picks from PROMPT_LIBRARY for the deepening
 * surface and the closer picks from GRATITUDE_LIBRARY here, and
 * (b) bumping one without the other shouldn't require coordinating
 * the schema across both.
 */
const parsed = PromptLibrarySchema.parse(gratitudeSeed);

export const GRATITUDE_LIBRARY: ReadonlyArray<Prompt> = parsed.prompts;
export const GRATITUDE_LIBRARY_KEYS: ReadonlyArray<string> = parsed.prompts.map((p) => p.key);

export function findGratitudePromptByKey(key: string): Prompt | null {
  return GRATITUDE_LIBRARY.find((p) => p.key === key) ?? null;
}
