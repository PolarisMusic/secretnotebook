/**
 * Prompt category taxonomy for the secret-unlock loop. Each prompt is
 * tagged with one or more categories; users pick which categories they
 * want served from the Prompt Preferences screen.
 *
 * Two groups:
 *   - "Stage" categories track relationship time-shape (dating → empty
 *     nest). Mostly mutually-exclusive in practice, but the taxonomy
 *     doesn't enforce that — a couple who married late could keep
 *     `dating` on too if they like those prompts.
 *   - "Cross-cutting" categories layer on top of any stage (intimacy,
 *     long-distance, etc.).
 *
 * Keep the keys append-only and stable: a key used in a `prompt.categories`
 * tag (or in someone's stored preferences) must keep resolving. New
 * categories append to PROMPT_CATEGORIES, never reorder; retire by dropping
 * from DEFAULT_VISIBLE_CATEGORIES only (the key stays defined here).
 */
export const PROMPT_CATEGORIES = [
  // Stage:
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
  // Cross-cutting:
  'intimacy',
  'reconnection',
  'long_distance',
  'caregiving',
  'general',
  'platonic',
] as const;

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

const PROMPT_CATEGORY_SET: ReadonlySet<string> = new Set(PROMPT_CATEGORIES);

/** Cheap typeguard for incoming strings — preferences come back from
 *  SQLite as a JSON-serialised string array, projector ops carry strings,
 *  and we want one place to drop unknown values. */
export function isPromptCategory(s: string): s is PromptCategory {
  return PROMPT_CATEGORY_SET.has(s);
}

/**
 * The 6 categories the Preferences screen shows in the collapsed default
 * view; the rest land behind "Show more". Order matches the screen.
 */
export const DEFAULT_VISIBLE_CATEGORIES: readonly PromptCategory[] = [
  'dating',
  'intimacy',
  'cohabitation',
  'married',
  'long_distance',
  'general',
  'platonic',
];

/**
 * Default enabled set for a user who has never opened the Preferences
 * screen — permissive ("everything on") so an upgraded install draws from
 * the full pool until the user opts categories out.
 */
export const DEFAULT_ENABLED_CATEGORIES: readonly PromptCategory[] = [...PROMPT_CATEGORIES];

/**
 * Human labels for the Preferences UI. Kept here (not in the screen) so
 * a category rename / re-copy lives in one place and any other surface
 * that displays category names (an admin import tool, an analytics dump)
 * stays in sync.
 */
export const CATEGORY_LABELS: Record<PromptCategory, string> = {
  dating: 'Dating',
  cohabitation: 'Cohabitation',
  engaged: 'Engaged',
  newlywed: 'Newlywed',
  married: 'Married (no kids)',
  expecting: 'Expecting',
  raising_babies: 'Raising babies (0–2)',
  raising_toddlers: 'Raising toddlers (2–5)',
  raising_kids: 'Raising kids (5–12)',
  raising_teens: 'Raising teens (13–18)',
  raising_adults: 'Raising adults (18+)',
  empty_nest: 'Empty nest',
  blended_family: 'Blended family',
  intimacy: 'Intimacy',
  reconnection: 'Reconnection',
  long_distance: 'Long distance',
  caregiving: 'Caregiving',
  general: 'General',
  platonic: 'Platonic',
};

/**
 * Short subtitle for each row in the Preferences UI — describes the
 * shape of challenges a category targets, so a user picking between them
 * has something more useful than the bare label.
 */
export const CATEGORY_DESCRIPTIONS: Record<PromptCategory, string> = {
  dating: 'Early days — curiosity, novelty, building a story together.',
  cohabitation: 'Sharing space — chores, routines, micro-negotiations.',
  engaged: 'Planning a life together — expectations, alignment.',
  newlywed: 'The first chapter as married — habits as a "we".',
  married: 'Settled together — keeping things alive without kids in the mix.',
  expecting: 'Trying to conceive, pregnancy, the wait.',
  raising_babies: 'Sleep, recovery, becoming parents.',
  raising_toddlers: 'High-needs years — patience, partnership, division of labour.',
  raising_kids: 'School-age — schedules, modelling, finding your own time.',
  raising_teens: 'Letting go bit by bit — discipline, trust, perspective.',
  raising_adults: 'Adult kids still at home — boundaries, transitions.',
  empty_nest: 'Recalibrating after kids leave — rediscovering each other.',
  blended_family: 'Step-parenting, co-parenting, mixed households.',
  intimacy: 'Physical and emotional closeness.',
  reconnection: 'Coming back together after a rough patch.',
  long_distance: 'Time apart, time-zones, intentional connection.',
  caregiving: 'Caring for aging parents, ill family, partner illness.',
  general: 'Universal — work for any couple, any stage.',
  platonic: 'Friendship, play, and connection without pressure.',
};
