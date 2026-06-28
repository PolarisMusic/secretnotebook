-- 0007 — relationship-prompt library, now server-owned.
--
-- Mobile clients used to ship a hardcoded prompt list. Moving it
-- server-side lets the operator add / edit / retire prompts and source
-- attribution without a mobile app deploy. Clients fetch the active set
-- on boot and cache it locally; the bundled hardcoded list survives as
-- an offline-first seed.
--
-- `key` is the stable identifier mobile ops carry. Once a key has shipped
-- in a `secret_unlock.start` op it MUST keep resolving — retiring a row
-- means setting `retired_at`, never deleting it. The mobile-side
-- `resolvePromptText` falls back to a neutral line for unknown keys, so
-- a dropped row degrades to "Do something thoughtful…" rather than
-- breaking the unlock loop.
--
-- `categories` is a JSON array of strings (the mobile taxonomy lives in
-- @secretnotebook/shared-types). Postgres-native JSONB rather than a
-- separate join table — there's no admin query that needs to filter
-- prompts by category server-side; the draw filter runs entirely on
-- mobile.
--
-- `source_name` / `source_url` carry attribution for prompts brought in
-- from outside libraries; `sponsored` flags ad-supported prompts so the
-- mobile renderer can label them explicitly.
CREATE TABLE prompt (
  key          TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  categories   JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_name  TEXT,
  source_url   TEXT,
  sponsored    BOOLEAN NOT NULL DEFAULT false,
  retired_at   TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Seed the 16 prompts that shipped on mobile so day-one fetches are
-- non-empty and existing op references still resolve.
INSERT INTO prompt (key, text, categories) VALUES
  ('pq_unhurried_walk',       'Take an unhurried walk together with no phones, and talk about something you have never told each other.', '["general","dating","cohabitation","married","empty_nest","reconnection","intimacy"]'),
  ('pq_cook_favourite',       'Cook or order your partner''s favourite meal and serve it to them.', '["general","dating","cohabitation","newlywed","married","blended_family","caregiving"]'),
  ('pq_love_letter',          'Hand-write a short note about a moment you felt closest to your partner, and read it to them.', '["general","dating","engaged","newlywed","long_distance","reconnection","intimacy"]'),
  ('pq_recreate_first_date',  'Recreate a detail from one of your early dates — a place, a song, a meal.', '["general","married","raising_kids","raising_teens","raising_adults","empty_nest","reconnection"]'),
  ('pq_full_attention',       'Give your partner thirty minutes of completely undivided attention doing whatever they choose.', '["general","cohabitation","married","raising_babies","raising_toddlers","raising_kids","raising_teens","intimacy"]'),
  ('pq_three_gratitudes',     'Tell your partner three specific things you are grateful for about them today.', '["general","dating","cohabitation","engaged","newlywed","married","expecting","raising_babies","raising_toddlers","raising_kids","raising_teens","raising_adults","empty_nest","blended_family","long_distance","reconnection"]'),
  ('pq_learn_their_day',      'Ask about your partner''s day and listen without offering advice or solutions.', '["general","cohabitation","married","expecting","raising_babies","raising_toddlers","raising_kids","raising_teens","raising_adults","caregiving","long_distance"]'),
  ('pq_surprise_small',       'Surprise your partner with a small gesture that shows you were thinking of them.', '["general","dating","cohabitation","engaged","newlywed","married","long_distance","reconnection"]'),
  ('pq_dance_one_song',       'Slow dance to one full song together, wherever you are.', '["general","dating","newlywed","married","raising_kids","raising_teens","empty_nest","intimacy"]'),
  ('pq_plan_future',          'Plan one small thing you are both looking forward to, and put it on the calendar together.', '["general","dating","engaged","newlywed","married","expecting","long_distance","empty_nest"]'),
  ('pq_ask_a_dream',          'Ask your partner about a dream or goal they have, and really dig into it with them.', '["general","dating","engaged","newlywed","married","raising_kids","raising_teens","raising_adults","empty_nest"]'),
  ('pq_unprompted_affection', 'Offer your partner ten seconds of unprompted physical affection — a hug, holding hands.', '["general","dating","cohabitation","newlywed","married","raising_babies","raising_toddlers","raising_kids","raising_teens","empty_nest","intimacy","reconnection"]'),
  ('pq_handle_a_chore',       'Quietly take care of a chore your partner usually handles, no credit needed.', '["general","cohabitation","newlywed","married","expecting","raising_babies","raising_toddlers","raising_kids","raising_teens","raising_adults","blended_family","caregiving"]'),
  ('pq_favourite_memory',     'Share your single favourite memory of the two of you and why it stuck with you.', '["general","dating","engaged","married","long_distance","empty_nest","reconnection","intimacy"]'),
  ('pq_compliment_specific',  'Give your partner a compliment about who they are, not how they look.', '["general","dating","cohabitation","engaged","newlywed","married","raising_babies","raising_toddlers","raising_kids","raising_teens","raising_adults","empty_nest","blended_family","caregiving","reconnection"]'),
  ('pq_phone_free_meal',      'Share one phone-free meal together and stay curious about each other the whole time.', '["general","cohabitation","married","raising_kids","raising_teens","raising_adults","empty_nest","reconnection"]')
ON CONFLICT (key) DO NOTHING;
