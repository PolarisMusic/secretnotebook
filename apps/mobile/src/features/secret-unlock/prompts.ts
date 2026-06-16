/**
 * R7 relationship-prompt library. Static, on-device content — the unlock
 * loop draws one prompt for the Unlocker to act on. Ops carry only the
 * stable `key`; the text is resolved here at render time, so editing or
 * expanding copy never breaks an in-flight attempt (an unknown key falls
 * back to a neutral line rather than throwing).
 *
 * Keep keys append-only and stable: a key that has shipped in an op must
 * keep resolving. Retire a prompt by removing it from the draw pool while
 * leaving its entry here for historical attempts.
 */
export interface UnlockPrompt {
  readonly key: string;
  readonly text: string;
}

// Typed as a non-empty tuple so index 0 is always defined — the draw can
// fall back to it without tripping noUncheckedIndexedAccess.
export const UNLOCK_PROMPTS: readonly [UnlockPrompt, ...UnlockPrompt[]] = [
  {
    key: 'pq_unhurried_walk',
    text: 'Take an unhurried walk together with no phones, and talk about something you have never told each other.',
  },
  {
    key: 'pq_cook_favourite',
    text: "Cook or order your partner's favourite meal and serve it to them.",
  },
  {
    key: 'pq_love_letter',
    text: 'Hand-write a short note about a moment you felt closest to your partner, and read it to them.',
  },
  {
    key: 'pq_recreate_first_date',
    text: 'Recreate a detail from one of your early dates — a place, a song, a meal.',
  },
  {
    key: 'pq_full_attention',
    text: 'Give your partner thirty minutes of completely undivided attention doing whatever they choose.',
  },
  {
    key: 'pq_three_gratitudes',
    text: 'Tell your partner three specific things you are grateful for about them today.',
  },
  {
    key: 'pq_learn_their_day',
    text: "Ask about your partner's day and listen without offering advice or solutions.",
  },
  {
    key: 'pq_surprise_small',
    text: 'Surprise your partner with a small gesture that shows you were thinking of them.',
  },
  { key: 'pq_dance_one_song', text: 'Slow dance to one full song together, wherever you are.' },
  {
    key: 'pq_plan_future',
    text: 'Plan one small thing you are both looking forward to, and put it on the calendar together.',
  },
  {
    key: 'pq_ask_a_dream',
    text: 'Ask your partner about a dream or goal they have, and really dig into it with them.',
  },
  {
    key: 'pq_unprompted_affection',
    text: 'Offer your partner ten seconds of unprompted physical affection — a hug, holding hands.',
  },
  {
    key: 'pq_handle_a_chore',
    text: 'Quietly take care of a chore your partner usually handles, no credit needed.',
  },
  {
    key: 'pq_favourite_memory',
    text: 'Share your single favourite memory of the two of you and why it stuck with you.',
  },
  {
    key: 'pq_compliment_specific',
    text: 'Give your partner a compliment about who they are, not how they look.',
  },
  {
    key: 'pq_phone_free_meal',
    text: 'Share one phone-free meal together and stay curious about each other the whole time.',
  },
];

const PROMPTS_BY_KEY: ReadonlyMap<string, UnlockPrompt> = new Map(
  UNLOCK_PROMPTS.map((p) => [p.key, p]),
);

/** Resolve a prompt's text by key. Returns a neutral fallback (never
 *  throws) so an op carrying a since-retired or unknown key still renders. */
export function resolvePromptText(key: string): string {
  return PROMPTS_BY_KEY.get(key)?.text ?? 'Do something thoughtful for your partner.';
}

/** True when the key maps to a live library entry (vs. a fallback render). */
export function isKnownPromptKey(key: string): boolean {
  return PROMPTS_BY_KEY.has(key);
}

/**
 * Draw a random prompt key from the live pool. `rng` is injectable so
 * tests can pin the draw; production passes nothing and gets Math.random.
 */
export function drawPromptKey(rng: () => number = Math.random): string {
  const idx = Math.floor(rng() * UNLOCK_PROMPTS.length);
  // Clamp the rng() === 1 / negative edges so we never index out of bounds;
  // fall back to the always-present first entry to satisfy the type.
  const safe = Math.min(Math.max(idx, 0), UNLOCK_PROMPTS.length - 1);
  return (UNLOCK_PROMPTS[safe] ?? UNLOCK_PROMPTS[0]).key;
}
