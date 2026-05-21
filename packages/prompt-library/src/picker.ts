import type { Prompt } from './types.js';

/**
 * Random source signature. Defaults to Math.random; callers can inject a
 * deterministic source for tests, or a libsodium-backed source for a
 * better entropy story on device. Must return a float in [0, 1).
 */
export type RandomSource = () => number;

export interface PickPromptOptions {
  /**
   * Library keys to exclude from this pick — the spec's "avoiding
   * immediate repeats" rule. Caller assembles the set (typically the
   * N most recently assigned prompts' library_keys); the picker just
   * filters.
   */
  readonly excludeKeys?: ReadonlyArray<string> | ReadonlySet<string>;
  /**
   * Optional bias: if set, prompts whose `suggestedAssignee` matches
   * `preferForAssignee` get twice the weight of others. Used by the
   * mobile assigner when the caller knows whether the recipient prefers
   * curator-flavoured or enactor-flavoured prompts. Ignored when null
   * or 'either' (no bias).
   */
  readonly preferForAssignee?: 'curator' | 'enactor' | 'either' | null;
  /** Random in [0, 1). Inject for tests. */
  readonly random?: RandomSource;
}

export interface PickedPrompt {
  prompt: Prompt;
  /** Index into the original library array, for debug / determinism. */
  index: number;
}

const PREFERRED_WEIGHT = 2;
const NEUTRAL_WEIGHT = 1;

/**
 * Weighted-random selection across the library, after filtering by
 * `excludeKeys`. Throws when no candidate remains — the caller should
 * either widen the exclusion window or reset it (the spec says "avoid
 * immediate repeats", not "never repeat").
 */
export function pickPromptWeighted(
  library: ReadonlyArray<Prompt>,
  opts: PickPromptOptions = {},
): PickedPrompt {
  if (library.length === 0) throw new Error('prompt library is empty');

  const excluded =
    opts.excludeKeys instanceof Set
      ? (opts.excludeKeys as ReadonlySet<string>)
      : new Set(opts.excludeKeys ?? []);
  const candidates: { prompt: Prompt; index: number; weight: number }[] = [];
  for (let i = 0; i < library.length; i++) {
    const p = library[i] as Prompt;
    if (excluded.has(p.key)) continue;
    const matchesPreference =
      opts.preferForAssignee &&
      opts.preferForAssignee !== 'either' &&
      p.suggestedAssignee === opts.preferForAssignee;
    candidates.push({
      prompt: p,
      index: i,
      weight: matchesPreference ? PREFERRED_WEIGHT : NEUTRAL_WEIGHT,
    });
  }
  if (candidates.length === 0) {
    throw new Error(`no prompt available — excluded ${excluded.size} of ${library.length}`);
  }

  const total = candidates.reduce((acc, c) => acc + c.weight, 0);
  const random = opts.random ?? Math.random;
  const r = random() * total;
  let acc = 0;
  for (const c of candidates) {
    acc += c.weight;
    if (r < acc) return { prompt: c.prompt, index: c.index };
  }
  // Floating-point edge case — random() returned a value that lands
  // exactly on `total` despite the [0, 1) contract. Fall through to
  // the last candidate rather than crash.
  const last = candidates[candidates.length - 1]!;
  return { prompt: last.prompt, index: last.index };
}
