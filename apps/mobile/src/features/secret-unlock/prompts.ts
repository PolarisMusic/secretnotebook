import { isPromptCategory, type PromptCategory } from './categories';
import { getCachedPrompts } from './prompt-cache';

/**
 * R7 relationship-prompt library. Prompts now live on the API server;
 * the mobile boot path fetches `/v1/prompts` into a local cache and the
 * resolve / draw paths read from that cache when warm. The constants
 * below are the bundled fallback shipped with the app — they're what
 * a cold install draws from before the first successful sync, and what
 * historical-op key resolution falls back to if a row has since been
 * dropped from the server set.
 *
 * Ops carry only the stable `key`; the text is resolved at render time,
 * so editing or expanding copy never breaks an in-flight attempt (an
 * unknown key falls back to a neutral line rather than throwing).
 *
 * Each prompt is tagged with one or more `categories`. The draw pool at
 * `drawPromptKey` time is intersected against each partner's enabled
 * categories (per `prompt_preference`), so a prompt qualifies iff it
 * carries at least one category each partner has on. `general` is the
 * universal safety tag and is on every bundled prompt — a couple with
 * only `general` enabled still has the full pool.
 *
 * Keep keys append-only and stable: a key that has shipped in an op must
 * keep resolving. Retire a prompt by removing it from the draw pool while
 * leaving its entry here for historical attempts.
 */
export interface UnlockPrompt {
  readonly key: string;
  readonly text: string;
  readonly categories: readonly PromptCategory[];
  /** External library / author attribution, when the prompt came from a
   *  named source the admin imported via the portal. */
  readonly sourceName?: string | null;
  /** Optional link to the source — used to render an attribution chip. */
  readonly sourceUrl?: string | null;
  /** Flag for ad-supported / partnered prompts; mobile labels the row. */
  readonly sponsored?: boolean;
}

// Typed as a non-empty tuple so index 0 is always defined — the draw can
// fall back to it without tripping noUncheckedIndexedAccess.
export const UNLOCK_PROMPTS: readonly [UnlockPrompt, ...UnlockPrompt[]] = [
  {
    key: 'pq_unhurried_walk',
    text: 'Take an unhurried walk together with no phones, and talk about something you have never told each other.',
    categories: [
      'general',
      'dating',
      'cohabitation',
      'married',
      'empty_nest',
      'reconnection',
      'intimacy',
    ],
  },
  {
    key: 'pq_cook_favourite',
    text: "Cook or order your partner's favourite meal and serve it to them.",
    categories: [
      'general',
      'dating',
      'cohabitation',
      'newlywed',
      'married',
      'blended_family',
      'caregiving',
    ],
  },
  {
    key: 'pq_love_letter',
    text: 'Hand-write a short note about a moment you felt closest to your partner, and read it to them.',
    categories: [
      'general',
      'dating',
      'engaged',
      'newlywed',
      'long_distance',
      'reconnection',
      'intimacy',
    ],
  },
  {
    key: 'pq_recreate_first_date',
    text: 'Recreate a detail from one of your early dates — a place, a song, a meal.',
    categories: [
      'general',
      'married',
      'raising_kids',
      'raising_teens',
      'raising_adults',
      'empty_nest',
      'reconnection',
    ],
  },
  {
    key: 'pq_full_attention',
    text: 'Give your partner thirty minutes of completely undivided attention doing whatever they choose.',
    categories: [
      'general',
      'cohabitation',
      'married',
      'raising_babies',
      'raising_toddlers',
      'raising_kids',
      'raising_teens',
      'intimacy',
    ],
  },
  {
    key: 'pq_three_gratitudes',
    text: 'Tell your partner three specific things you are grateful for about them today.',
    categories: [
      'general',
      'dating',
      'cohabitation',
      'engaged',
      'newlywed',
      'married',
      'expecting',
      'raising_babies',
      'raising_toddlers',
      'raising_kids',
      'raising_teens',
      'raising_adults',
      'empty_nest',
      'blended_family',
      'long_distance',
      'reconnection',
    ],
  },
  {
    key: 'pq_learn_their_day',
    text: "Ask about your partner's day and listen without offering advice or solutions.",
    categories: [
      'general',
      'cohabitation',
      'married',
      'expecting',
      'raising_babies',
      'raising_toddlers',
      'raising_kids',
      'raising_teens',
      'raising_adults',
      'caregiving',
      'long_distance',
    ],
  },
  {
    key: 'pq_surprise_small',
    text: 'Surprise your partner with a small gesture that shows you were thinking of them.',
    categories: [
      'general',
      'dating',
      'cohabitation',
      'engaged',
      'newlywed',
      'married',
      'long_distance',
      'reconnection',
    ],
  },
  {
    key: 'pq_dance_one_song',
    text: 'Slow dance to one full song together, wherever you are.',
    categories: [
      'general',
      'dating',
      'newlywed',
      'married',
      'raising_kids',
      'raising_teens',
      'empty_nest',
      'intimacy',
    ],
  },
  {
    key: 'pq_plan_future',
    text: 'Plan one small thing you are both looking forward to, and put it on the calendar together.',
    categories: [
      'general',
      'dating',
      'engaged',
      'newlywed',
      'married',
      'expecting',
      'long_distance',
      'empty_nest',
    ],
  },
  {
    key: 'pq_ask_a_dream',
    text: 'Ask your partner about a dream or goal they have, and really dig into it with them.',
    categories: [
      'general',
      'dating',
      'engaged',
      'newlywed',
      'married',
      'raising_kids',
      'raising_teens',
      'raising_adults',
      'empty_nest',
    ],
  },
  {
    key: 'pq_unprompted_affection',
    text: 'Offer your partner ten seconds of unprompted physical affection — a hug, holding hands.',
    categories: [
      'general',
      'dating',
      'cohabitation',
      'newlywed',
      'married',
      'raising_babies',
      'raising_toddlers',
      'raising_kids',
      'raising_teens',
      'empty_nest',
      'intimacy',
      'reconnection',
    ],
  },
  {
    key: 'pq_handle_a_chore',
    text: 'Quietly take care of a chore your partner usually handles, no credit needed.',
    categories: [
      'general',
      'cohabitation',
      'newlywed',
      'married',
      'expecting',
      'raising_babies',
      'raising_toddlers',
      'raising_kids',
      'raising_teens',
      'raising_adults',
      'blended_family',
      'caregiving',
    ],
  },
  {
    key: 'pq_favourite_memory',
    text: 'Share your single favourite memory of the two of you and why it stuck with you.',
    categories: [
      'general',
      'dating',
      'engaged',
      'married',
      'long_distance',
      'empty_nest',
      'reconnection',
      'intimacy',
    ],
  },
  {
    key: 'pq_compliment_specific',
    text: 'Give your partner a compliment about who they are, not how they look.',
    categories: [
      'general',
      'dating',
      'cohabitation',
      'engaged',
      'newlywed',
      'married',
      'raising_babies',
      'raising_toddlers',
      'raising_kids',
      'raising_teens',
      'raising_adults',
      'empty_nest',
      'blended_family',
      'caregiving',
      'reconnection',
    ],
  },
  {
    key: 'pq_phone_free_meal',
    text: 'Share one phone-free meal together and stay curious about each other the whole time.',
    categories: [
      'general',
      'cohabitation',
      'married',
      'raising_kids',
      'raising_teens',
      'raising_adults',
      'empty_nest',
      'reconnection',
    ],
  },
];

const BUNDLED_PROMPTS_BY_KEY: ReadonlyMap<string, UnlockPrompt> = new Map(
  UNLOCK_PROMPTS.map((p) => [p.key, p]),
);

/**
 * Synchronous "live pool" for resolve + draw. Reads the in-memory cache
 * if it's been populated this session; otherwise falls back to the
 * bundled tuple. Returning a `readonly UnlockPrompt[]` (non-empty in
 * both branches) lets the callers stay strict.
 */
function getActivePrompts(): readonly UnlockPrompt[] {
  const cached = getCachedPrompts();
  return cached && cached.length > 0 ? cached : UNLOCK_PROMPTS;
}

/** Look up a prompt by key. Server-cached entries win; bundled entries
 *  serve as the fallback so a key shipped before a server retire still
 *  resolves something meaningful. Returns null when neither has it. */
export function findPrompt(key: string): UnlockPrompt | null {
  const cached = getCachedPrompts();
  if (cached) {
    const hit = cached.find((p) => p.key === key);
    if (hit) return hit;
  }
  return BUNDLED_PROMPTS_BY_KEY.get(key) ?? null;
}

/** Resolve a prompt's text by key. Returns a neutral fallback (never
 *  throws) so an op carrying a since-retired or unknown key still renders. */
export function resolvePromptText(key: string): string {
  return findPrompt(key)?.text ?? 'Do something thoughtful for your partner.';
}

/** True when the key maps to a live library entry (vs. a fallback render). */
export function isKnownPromptKey(key: string): boolean {
  return findPrompt(key) != null;
}

/** The unlocker's enabled category set. An empty set means "everything
 *  enabled" — the default before the user has opened Preferences. */
export interface DrawFilters {
  readonly self: ReadonlySet<string>;
}

function matchesCategoryFilter(prompt: UnlockPrompt, enabled: ReadonlySet<string>): boolean {
  if (enabled.size === 0) return true;
  return prompt.categories.some((c) => enabled.has(c));
}

/**
 * Draw a random prompt key. Preferences are the *unlocker's own* setting —
 * each person's filter is independent and never requires matching the
 * partner's. A filter that produces an empty pool falls back to prompts
 * carrying `general`, then the full pool — so the draw can never fail.
 *
 * `rng` is injectable so tests can pin the draw; production passes nothing
 * and gets `Math.random`.
 */
export function drawPromptKey(rng: () => number = Math.random, filters?: DrawFilters): string {
  const active = getActivePrompts();
  let pool: ReadonlyArray<UnlockPrompt> = active;
  if (filters && filters.self.size > 0) {
    const filtered = active.filter((p) => matchesCategoryFilter(p, filters.self));
    if (filtered.length > 0) {
      pool = filtered;
    } else {
      const fallback = active.filter((p) => p.categories.includes('general'));
      pool = fallback.length > 0 ? fallback : active;
    }
  }
  const idx = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
  const safe = Math.max(idx, 0);
  return (pool[safe] ?? pool[0] ?? UNLOCK_PROMPTS[0]).key;
}

/** Strip any category strings that aren't in the live taxonomy. Useful
 *  when reading a `prompt_preference` row that might have been written
 *  by an older or rolled-back build carrying a since-retired tag. */
export function sanitizeCategories(input: readonly string[]): PromptCategory[] {
  const seen = new Set<PromptCategory>();
  const out: PromptCategory[] = [];
  for (const c of input) {
    if (isPromptCategory(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Pick `n` random prompt texts from the live pool to feed the unlock-start
 * shuffle animation. Duplicates are allowed (the cycle just flashes by);
 * `n` is clamped to be at least 1 even if the pool is empty.
 */
export function drawRandomPromptTexts(n: number, rng: () => number = Math.random): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, n); i++) {
    const idx = Math.min(Math.floor(rng() * UNLOCK_PROMPTS.length), UNLOCK_PROMPTS.length - 1);
    out.push((UNLOCK_PROMPTS[idx] ?? UNLOCK_PROMPTS[0]).text);
  }
  return out;
}
