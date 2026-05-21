import seed from './seed.json';
import { PromptLibrarySchema, type Prompt, type PromptLibrary } from './types.js';

/**
 * Parse the bundled seed JSON through the schema once at module load.
 * Throws at startup if the seed is malformed — preferable to discovering
 * a typo at assign time on a user's phone.
 */
const parsed: PromptLibrary = PromptLibrarySchema.parse(seed);

export const PROMPT_LIBRARY: ReadonlyArray<Prompt> = parsed.prompts;
export const PROMPT_LIBRARY_VERSION: 1 = parsed.version;
export const PROMPT_LIBRARY_KEYS: ReadonlyArray<string> = parsed.prompts.map((p) => p.key);

/** Find a prompt by its stable library key. Returns null if missing. */
export function findPromptByKey(key: string): Prompt | null {
  return PROMPT_LIBRARY.find((p) => p.key === key) ?? null;
}
