# Tester Feedback — Implementation Plan

A worklist of 12 fixes from testing, written so an implementer can pick up each
one in isolation. Each item has: the **finding** (root cause, grounded in the
code), the **exact files/changes**, **verbatim copy** where copy is specified,
**tests**, and a **complexity** tag.

## How to use this doc

- Branch: do all work on `claude/exciting-turing-fmzfo1`. Commit per-issue with a
  clear message; push when done.
- After each change run, from the repo root: `pnpm -w lint && pnpm -w typecheck && pnpm -w test`.
  The mobile native paths (camera, audio, image picker) are **not** covered by
  Jest — verify those on device per `apps/mobile/RUNBOOK.md`.
- **Do not rename internal identifiers** (`safeword_*` columns, `SafeWord*`
  symbols, `term-store`, CRDT op kinds) or **testIDs** (`settings.safeword`,
  `screen.safeword`, `settings.role.<role>`, etc.). Detox/unit tests and the sync
  protocol depend on them. Only change **user-visible copy** unless a step says
  otherwise.
- Codebase conventions worth copying: presentational screens take deps as props,
  `*Route.tsx` wires them from Zustand stores; new synced fields ride a CRDT op
  in `packages/connection-protocol/src/crdt/op.ts` and are applied in
  `apps/mobile/src/features/connection-channel/projector.ts`; device-local
  settings use the `app_setting` KV via `features/settings/store.ts`
  (`getAppSetting`/`setAppSetting`).

## Recommended order (easiest / highest-confidence first)

| # | Issue | Complexity | Good for a cheaper model? |
|---|-------|-----------|---------------------------|
| 5 | "Roleplay Term" → "Safe Word" + copy | Trivial (copy) | ✅ |
| 6 | "My Role" copy + default neutral | Trivial (copy + display) | ✅ |
| 7 | Add "Platonic" prompt category | Trivial (data) | ✅ |
| 1 | Long notes won't scroll / photo viewer opens on scroll | Small | ✅ |
| 9 | Photo preview while composing | Small | ✅ |
| 2 | Admin UI 404 at `/v1/admin/ui/` | Small | ✅ |
| 3 | `DEV_GRANT_ENTITLEMENT` still says "Subscribe to publish" | Small (mostly operational) | ✅ |
| 4 | Cancel a proposed Safe Word | Medium (new CRDT op) | ⚠️ with care |
| 10 | Note titles | Medium (migration + op) | ⚠️ with care |
| 8 | Onboarding flow | Large | ❌ keep on a stronger model |
| 11 | Voice note output selection | Spike + native | ❌ needs native work |

Decisions I made for the ambiguous items (#8, #10, #11) are called out inline and
collected at the bottom under **Decisions to confirm**.

---

## 1. Long notes won't scroll; scrolling a photo note opens the photo viewer

**Complexity:** Small. **Files:** `apps/mobile/src/screens/notes/NotesDetail.tsx`.

**Finding.** The note body + attachments render inside a plain
`<View style={styles.content}>` (around line 154) — there is **no ScrollView**, so
any content taller than the screen is unreachable. The photo thumbnail is a
`Pressable` whose `onPress` opens the full-screen viewer (around lines 184–197);
because nothing owns the drag gesture, a swipe-to-scroll lands as a tap and opens
the viewer. A `ScrollView` fixes **both**: it makes content scroll, and (with its
default `canCancelContentTouches`) it cancels the child `Pressable` when a drag
becomes a scroll, so dragging scrolls and only a clean tap opens the viewer.

**Changes.**
1. Replace the content container `<View style={styles.content}> … </View>`
   (the block guarded by `{note ? ( … ) : null}`) with
   `<ScrollView contentContainerStyle={styles.content}>…</ScrollView>`.
   Import `ScrollView` from `react-native`.
2. Keep the header, the options `Modal`, and `<ImageViewerModal …/>` **outside**
   the ScrollView (they already are siblings — leave them where they are).
3. Leave `styles.content` as-is (`padding: 16, gap: 16`); it works as a
   `contentContainerStyle`.

**Test (device).** Open a long note → it scrolls. Open a note with a photo →
dragging on the image scrolls the page (does not open the viewer); a single tap
on the image still opens the full-screen viewer.

---

## 2. Admin UI 404 at `https://…/v1/admin/ui/`

**Complexity:** Small. **Files:** `apps/api/src/server.ts` (+ deploy config check).

**Finding.** Two independent reasons it can 404:
1. **Trailing slash.** The route is registered as `GET /v1/admin/ui` (no trailing
   slash) in `apps/api/src/routes/admin-ui.ts`. Fastify does **not** ignore
   trailing slashes by default, and the URL the tester used ends in `/`
   (`/v1/admin/ui/`) → 404. (`buildApp` in `server.ts` constructs Fastify with no
   `ignoreTrailingSlash`.)
2. **Admin surface not registered.** The admin routes only register
   `if (opts.env.ADMIN_TOKEN)` (server.ts, ~line 111). If `ADMIN_TOKEN` is not set
   on the Fly app, there are **no** `/v1/admin/*` routes at all → 404 with or
   without the slash.

**How to tell which.** `curl -i https://polaris-secretnotebook-api.fly.dev/v1/admin/ui`
(no trailing slash). If it returns the HTML login page → only the trailing slash
is the bug. If it also 404s → `ADMIN_TOKEN` is missing.

**Changes.**
1. In `server.ts`, construct Fastify with trailing-slash tolerance:
   ```ts
   const app = fastify({
     logger: { level: opts.env.LOG_LEVEL },
     ignoreTrailingSlash: true,
   }).withTypeProvider<ZodTypeProvider>();
   ```
   This is app-wide and safe (the API uses exact paths); both `/v1/admin/ui` and
   `/v1/admin/ui/` then resolve.
2. Confirm `ADMIN_TOKEN` is configured for the deployed app. Check
   `apps/api/src/config.ts` to confirm `ADMIN_TOKEN` is part of the `Env`
   shape/optional, and on the host run `fly secrets list -a polaris-secretnotebook-api`.
   If absent: `fly secrets set ADMIN_TOKEN=<long-random> -a polaris-secretnotebook-api`
   (this is operational, not a code change). Sign in at the page with that token.

**Test.** An API integration test (`apps/api/tests`) can assert that
`app.inject({ method: 'GET', url: '/v1/admin/ui/' })` returns 200 (login page)
when `ADMIN_TOKEN` is set. Mirror an existing admin test if present.

---

## 3. `EXPO_PUBLIC_DEV_GRANT_ENTITLEMENT=1` but still "Subscribe to publish"

**Complexity:** Small — **the cause is almost certainly operational, not a code bug.**
**Files:** `apps/mobile/.env.example` (doc), `apps/mobile/src/features/boot/run.ts`
(diagnostic), and optionally the Diagnostics screen.

**Finding.** The wiring is correct. At boot (`features/boot/run.ts`), when
`DEV_GRANT_ENTITLEMENT` is true it installs the `devGrantBridge` +
`devGrantValidator` pair and `restoreEntitlementOnBoot` caches a one-year
entitlement; `requireCurrentEntitlement` then passes and publish works.
`DEV_GRANT_ENTITLEMENT` (`features/iap/config.ts`) is
`process.env.EXPO_PUBLIC_DEV_GRANT_ENTITLEMENT === '1'`, which **Metro inlines at
bundle-build time**. The "Subscribe to publish" message is
`EntitlementError('no-entitlement')` — i.e. the entitlement table is empty — which
means the flag was **false at the moment the JS bundle was built**. Two gotchas:

- **Metro reads `apps/mobile/.env`, not `.env.example`.** `.env.example` is
  documentation only; editing it changes nothing. The committed `.env.example` in
  the repo is `0`. The real value must be in `apps/mobile/.env`.
- **`EXPO_PUBLIC_*` is baked at build time.** Editing `.env` and hot-reloading
  keeps the old baked value. You must restart Metro with cache cleared
  (`pnpm --filter @secretnotebook/mobile exec expo start -c`) and reinstall the
  app; a TestFlight/EAS build bakes whatever was set when that build was made — it
  must be rebuilt with the flag on.

**Changes (so this is diagnosable at runtime — the actual fix is rebuilding).**
1. In `run.ts`, capture and log the restore result. `restoreEntitlementOnBoot`
   already returns `{ reason }`:
   ```ts
   const restore = await restoreEntitlementOnBoot({ … });
   console.log(`[iap] devGrant=${DEV_GRANT_ENTITLEMENT} restore=${restore.reason}`);
   ```
   A correctly-built tester build logs `devGrant=true restore=cached`. If you see
   `devGrant=false`, the flag didn't bake — it's the build/env issue above.
2. (Optional, recommended) Surface it in the existing Diagnostics screen
   (`apps/mobile/src/screens/diagnostics/…`): show `DEV_GRANT_ENTITLEMENT` and the
   result of `getCachedEntitlement(exec)` (product id + `expiresAt`) so a tester
   can confirm without a debugger.
3. Tighten the doc so testers stop editing the wrong file. In
   `apps/mobile/.env.example`, add to the `DEV_GRANT` comment block:
   *"Editing THIS file (.env.example) has no effect — Metro only reads `.env`.
   Copy it to `apps/mobile/.env`, set the value, and rebuild with a cleared cache
   (`expo start -c`)."*

**Test.** With `apps/mobile/.env` containing `EXPO_PUBLIC_DEV_GRANT_ENTITLEMENT=1`,
run `expo start -c`, reinstall, and confirm the boot log shows
`devGrant=true restore=cached` and that publishing succeeds.

---

## 4. Cancel a Safe Word you proposed (partner hasn't confirmed)

**Complexity:** Medium — adds one CRDT op. **Files:** `packages/connection-protocol/src/crdt/op.ts`,
`apps/mobile/src/features/connection-channel/projector.ts`,
`apps/mobile/src/features/safeword/term-store.ts`,
`apps/mobile/src/screens/safeword/SafeWordRoute.tsx`, plus tests.

**Finding.** There is no way to withdraw a proposal. The proposer's UI state
`awaiting_partner` (SafeWordRoute, ~lines 275–282) shows only "Waiting for your
partner to confirm…", and `term-store.ts` has no cancel function. The proposal
lives in the `safeword_proposal_*` columns on **both** devices (proposer:
`awaiting_partner`; partner: `incoming_proposal`), so a local-only clear would
leave the partner still seeing the proposal. A small new op fixes it cleanly,
mirroring the existing `propose`/`confirm` and `sever.cancel` patterns.

**Important invariant (verified):** the Safe Word salt is **deterministic** —
`deriveSafeWordSalt(rootKey) = HKDF(rootKey, "secretnotebook/safeword-salt/v1")`
(`features/safeword/verifier.ts`). So `proposeTerm` rewriting `safeword_salt` always
writes the same bytes, and a withdraw that clears **only** the `safeword_proposal_*`
columns leaves any previously-confirmed term (`safeword_verifier`/`safeword_term`/
`safeword_confirmed_at`) fully valid. Do **not** touch those columns on withdraw.

**Changes.**
1. **op.ts** — add the op next to the other safeword ops, and into `CrdtOpSchema`:
   ```ts
   export const ConnectionSafeWordWithdrawOpSchema = z
     .object({
       v: z.literal(1),
       kind: z.literal('connection.safeword.withdraw'),
       withdrawerPubkey: HexString(32),
       withdrawnAt: z.number().int().nonnegative(),
     })
     .strict();
   export type ConnectionSafeWordWithdrawOp = z.infer<typeof ConnectionSafeWordWithdrawOpSchema>;
   ```
   Add `ConnectionSafeWordWithdrawOpSchema` to the `CrdtOpSchema` discriminated
   union list.
2. **projector.ts** — add a `case 'connection.safeword.withdraw'` (model it on the
   `propose`/`confirm` cases). Enforce `op.withdrawerPubkey === senderHex`, then
   clear the proposal columns **only if the pending proposal belongs to the
   withdrawer** (so it can't wipe the other side's proposal or a confirmed term):
   ```ts
   const withdrawer = hexToBytes(op.withdrawerPubkey);
   await exec.execute(
     `UPDATE connection
         SET safeword_proposal_verifier = NULL,
             safeword_proposal_by       = NULL,
             safeword_proposal_at       = NULL,
             safeword_proposal_term     = NULL
       WHERE (partner_a_pubkey = ? OR partner_b_pubkey = ?)
         AND safeword_proposal_by = ?`,
     [withdrawer, withdrawer, withdrawer],
   );
   return;
   ```
   (The `default:` exhaustiveness guard will force you to add this branch — good.)
3. **term-store.ts** — add `withdrawProposal(deps: TermStoreDeps)`. Load the
   connection, `assertSelfIsPartner`, require `safeword_proposal_by` is non-null
   **and equals self** (you can only withdraw your own pending proposal — otherwise
   throw "No proposal of yours to cancel"), then in a transaction clear the same
   four columns locally and `enqueue` the withdraw op. Mirror the transaction
   shape of `proposeTerm`. Add `ConnectionSafeWordWithdrawOp` to the
   `SafeWordTermOp` union type at the top of the file.
4. **SafeWordRoute.tsx** — add a `handleWithdraw` (mirror `handlePropose`) and a
   "Cancel proposal" button in the `awaiting_partner` block, and in the
   `state.kind === 'set' && changing` block when a change-proposal is pending. After
   success, `refresh()` returns the UI to `none` (no prior term) or `set` (prior
   term preserved). Settings already advertises this ("tap to manage or cancel" in
   `SettingsRoute.tsx`), so no Settings change is needed.
5. **Tests.** Add a `term-store` unit test for `withdrawProposal` (propose →
   withdraw → state back to `none`/`set`; withdrawing someone else's proposal
   throws) and a projector test for the new case (mirror the existing safeword
   tests in `apps/mobile/tests/`). Update any op round-trip / op-count tests in
   `packages/connection-protocol/tests/crdt-op.test.ts`.

---

## 5. Rename "Roleplay Term" → "Safe Word" + new copy

**Complexity:** Trivial (copy only). **Files:** `SafeWordRoute.tsx`,
`SettingsRoute.tsx`, `NotesCompose.tsx` (and grep for stragglers).

**Finding.** The README/internal code already call it "Safe Word"; only the
user-facing copy still says "Roleplay term". Replace visible strings only — leave
symbols, file names, columns, and testIDs unchanged.

**Changes.**
1. Find every visible occurrence: search `apps/mobile/src` (case-insensitive) for
   `roleplay`. Known spots:
   - `screens/safeword/SafeWordRoute.tsx`: header `<ScreenHeader title="Roleplay term" />`
     → `title="Safe Word"`; the hints ("set a shared roleplay term", "Your partner
     proposed a roleplay term", etc.).
   - `screens/settings/SettingsRoute.tsx`: section label `ROLEPLAY TERM` → `SAFE WORD`.
   - `screens/notes/NotesCompose.tsx`: "Set a shared roleplay term with your
     partner?" → "Set a shared Safe Word with your partner?".
2. Use this **verbatim** description where the Safe Word is introduced/explained
   (replace the `SET A TERM` hint in `SafeWordRoute.tsx`, and reuse for the
   change-term hint):

   > This should be a distinctive word or phrase you would not typically use with
   > each other. This is the term either person can use if they need to take a break.

3. Capitalize consistently as **"Safe Word"** in titles/labels and "safe word" in
   mid-sentence prose where it already does so (e.g. the "Use the safe word" button
   can stay lowercase mid-phrase).

**Test.** Lint/typecheck; eyeball the Safe Word screen, Settings, and the compose
nudge. Confirm testIDs (`screen.safeword`, `settings.safeword`, `safeword.*`)
are unchanged.

---

## 6. "My Role" copy + default to neutral

**Complexity:** Trivial (copy + display default). **Files:** `SettingsRoute.tsx`,
`screens/connection/ConnectionHome.tsx`.

**Finding.** Role values are `'masculine' | 'feminine' | 'neutral'` and the stored
value is `null` until the user picks one. The app **already treats `null` like
`neutral`** behaviourally: `effectiveAudience(null, …)` returns "no filter / show
everything" exactly as for `neutral` (`features/feed/audience.ts`), and
`roleDefaultPointsVisible(null)` matches neutral. So **no logic change is needed** —
only (a) the explanatory copy and (b) showing neutral as the selected default in
the picker so it doesn't look "unset".

**Changes.**
1. **Copy.** In `SettingsRoute.tsx`, replace the MY ROLE hint
   (`<Text style={styles.hint}>How the app speaks to you.</Text>`) with this
   **verbatim** text:

   > Controls the default view of the public feed and certain UI settings. All
   > other settings can be changed independently of this setting.

2. **Default-neutral display (no DB write).** In `SettingsRoute.tsx`, compute
   `const effectiveRole = myRole ?? 'neutral'` and use `effectiveRole` for the
   pill "active" state (`effectiveRole === role`) so **neutral is highlighted by
   default**. Do **not** call `setMyRole` automatically — writing would emit a
   needless `role.set` op to the partner and requires the engine. Leaving storage
   `null` (treated as neutral) is exactly "equivalent" as requested.
3. In `ConnectionHome.tsx`, change `roleLabel(null)` from `'— (not set)'` to
   `'neutral'` (and, like Settings, select neutral by default in the picker).

**Test.** Fresh paired device: role shows **neutral** selected; the feed default
view and points-visibility behave the same as before; picking masculine/feminine
still works and persists.

---

## 7. Add "Platonic" to relationship prompt categories

**Complexity:** Trivial (data). **Files:**
`apps/mobile/src/features/secret-unlock/categories.ts`,
`apps/api/src/routes/admin-ui.ts` (+ any category-count test).

**Finding.** Categories are an append-only taxonomy (`categories.ts`); the server
accepts any snake_case key, and the admin UI lists checkboxes from a hand-synced
`CATEGORY_HINTS` array. The op cap is `PROMPT_CATEGORY_KEY_MAX = 40` — `platonic`
fits. `DEFAULT_ENABLED_CATEGORIES` is `[...PROMPT_CATEGORIES]`, so a new key is
enabled by default automatically.

**Changes.**
1. `categories.ts`:
   - Append `'platonic'` to the end of `PROMPT_CATEGORIES` (append-only — do not
     reorder existing keys).
   - Add `platonic: 'Platonic'` to `CATEGORY_LABELS`.
   - Add a description to `CATEGORY_DESCRIPTIONS`, e.g.
     `platonic: 'Friendship-first — closeness and care without romance or sex.'`
     (adjust wording to taste).
   - Add `'platonic'` to `DEFAULT_VISIBLE_CATEGORIES` so it shows without "Show
     more" (it's a category testers should see). Place it wherever you want in that
     display-order array.
2. `apps/api/src/routes/admin-ui.ts`: add `{ key: 'platonic', label: 'Platonic' }`
   to `CATEGORY_HINTS` (keep it in sync with the client list).
3. Update any test that asserts the number of categories (check
   `apps/mobile/tests/secret-unlock-prompts.test.ts`).

**Test.** Prompt Preferences screen shows "Platonic"; the admin UI shows the
Platonic checkbox; lint/typecheck/test pass.

---

## 8. Onboarding flow

**Complexity:** Large — net-new flow. **Keep this on a stronger model.**
**Files:** new onboarding components + `navigation/RootStack.tsx`,
`features/settings/store.ts` (new KV flag), reuse of existing routes.

**Finding (important — the current "onboarding" is mostly gone).** `RootStack`
renders only **AppLock → MainStack**; `MainStack` opens on `NotesList`, and pairing
is a **modal** (`Pairing`), not a gate. The old `OnboardingStack` is effectively
dead (only its param-list type is imported by `WelcomeScreen`). The only first-run
UI today is `IntroOverlay`, shown once on `NotesList` and gated by `INTRO_SEEN_KEY`
in the `app_setting` KV. So this is a **new** multi-step flow, not an edit of the
old stack.

**Hard constraint that shapes the design.** Three of the five requested steps —
**Set Role**, **Set prompt categories**, **Set Safe Word** — all require a paired
connection: they call `setMyRole` / `setMyPromptCategories` / `proposeTerm`, which
need `engine.selfPub` and `engine.enqueue` (the SyncEngine only exists once paired).
They therefore **cannot be completed before "Connect with partner."** The requested
order (Role → Categories → Connect → Safe Word) can't run literally.

**Recommended approach — Option A (connect-gated, with skips).** This is far less
code and has fewer failure modes; it honors "allow skip":

1. Add a device-local flag `ONBOARDING_COMPLETE_KEY = 'onboarding_complete'` in
   `features/settings/store.ts` (same pattern as `INTRO_SEEN_KEY`). Set it `'1'`
   when the flow finishes or the user skips out.
2. In `RootStack`, when unlocked **and** `onboarding_complete !== '1'`, render a new
   `OnboardingFlow` instead of `MainStack`. (Read the flag with `getAppSetting`;
   keep a loading state until it resolves so you don't flash the wrong screen.)
   Retire the `IntroOverlay`/`INTRO_SEEN` path or fold its content into the welcome
   step.
3. `OnboardingFlow` is a small stepper (a tiny stack or an index-driven component),
   each step full-screen with **Skip**/**Continue** and a progress indicator:
   - **Welcome** — intro copy (reuse `WelcomeScreen` text).
   - **Connect with partner (skip)** — reuse `PairWithPartnerRoute`. This is the
     gate for the next three steps.
   - **If now paired:** **Set Role (skip)** (reuse the `ConnectionHome` role picker
     UI calling `setMyRole`), then **Set prompt categories (skip)** (reuse
     `PromptPreferencesRoute` → `setMyPromptCategories`), then **Set Safe Word
     (skip)** (reuse `SafeWordRoute`'s propose path). **If the user skipped
     pairing**, auto-skip these three (they're unreachable) — the user can do them
     later from Settings.
   - **Allow camera / photos / microphone ("Maybe later")** — three "Allow"
     buttons calling the same APIs already used in
     `features/attachments/native.ts`: `ImagePicker.requestMediaLibraryPermissionsAsync()`,
     `ImagePicker.requestCameraPermissionsAsync()`, `Audio.requestPermissionsAsync()`.
     A "Maybe later" button just proceeds. (Permissions are also requested lazily at
     first use today, so deferring is safe.)
   - On finish/skip-all, write `onboarding_complete = '1'` and fall through to
     `MainStack`.

**Alternative — Option B (literal order, deferred apply).** Only if the literal
Role→Categories→Connect order is a hard requirement: collect Role + Categories as
**pending device-local values** before pairing (store in `app_setting`), then add a
post-pairing hook that applies them via `setMyRole`/`setMyPromptCategories` once the
engine exists (e.g. right after pairing completes / next boot with an engine). This
needs a pending-choices store + a flush hook + handling "never paired." More code,
more edge cases — not recommended for a less-skilled model.

**Tests.** Flow-level coverage is mostly device/Detox (`apps/mobile/e2e`). Unit-test
the new KV flag helpers and any pure step-gating logic. Confirm an
already-onboarded device boots straight to `NotesList`.

> This item is intentionally the most detailed because it's the riskiest. If you
> want, I can split it into its own sub-plan with screen-by-screen specs.

---

## 9. Photo preview while composing a note

**Complexity:** Small. **Files:** `screens/notes/NotesCompose.tsx`,
`screens/notes/NotesComposeRoute.tsx`.

**Finding.** Staged media shows only a "Photo"/"Voice" text chip (no thumbnail).
The displayable image is the **plaintext** picker URI `picked.uri`
(`PickedMedia.uri`), available in `NotesComposeRoute.stageAndPrepare`. (Note:
`PreparedAttachment.localUri` is the **encrypted** file and can't be shown in an
`<Image>`, so use the plaintext picker URI for the preview.)

**Changes.**
1. `NotesCompose.tsx`: add `previewUri?: string` to the `StagedMedia` interface.
2. In the chip render, when `m.mediaType === 'image' && m.previewUri`, render a
   small thumbnail, e.g. `<Image source={{ uri: m.previewUri }} style={styles.chipThumb} />`
   (≈44×44, `borderRadius: 6`), in place of (or alongside) the "Photo" label. Keep
   the remove (✕) button and the preparing/error states.
3. `NotesComposeRoute.tsx`: in `stageAndPrepare`, when adding the staged item set
   `previewUri: picked.mediaType === 'image' ? picked.uri : undefined`. `picked` is
   already in scope at the `setStaged(s => [...s, {…}])` call.

This is in-memory compose state only; the encrypt/upload path is unchanged.

**Test (device).** Pick or capture a photo → its thumbnail appears in the chip;
remove works; saving the note still works. Voice chips are unchanged.

---

## 10. Note titles (optional, defaulting to the first few words)

**Complexity:** Medium — migration + optional synced field. **There is an exact
precedent to copy:** `reveal_comment` was added the same way (migration
`022-reveal-comment`, an optional `revealComment` on `NoteSecretRevealOpSchema`,
threaded through store + projector). Follow that pattern.

**Files:** new migration `023-note-title`, `db/migrations/index.ts`,
`packages/connection-protocol/src/crdt/op.ts`, `features/notes/store.ts`,
`features/notes/compose-wiring.ts`, `features/connection-channel/projector.ts`,
`screens/notes/NotesCompose.tsx`, `NotesComposeRoute.tsx`, `NotesDetail.tsx`,
`NotesList.tsx`, plus tests.

**Decision (privacy-consistent):** Title is real content that travels **with the
body** — on `note.share.add` for shared notes, and on `note.secret.reveal` (not on
`note.secret.announce`) for secret notes, so a secret's title stays off the wire
until reveal, exactly like its body. The author's local row carries the title from
creation. **Default title is derived at display time** from the first few words of
the body (so it tracks edits); only an explicitly-entered title is persisted.

**Changes.**
1. **Migration `023-note-title.ts`** (copy the shape of `022-reveal-comment.ts`):
   `ALTER TABLE note ADD COLUMN title TEXT;` (nullable). Register it in
   `db/migrations/index.ts` as `{ id: 23, name: 'note-title', sql: noteTitleSql }`.
2. **op.ts:** add `title: z.string().min(1).max(120).optional()` to
   `NoteShareAddOpSchema` and `NoteSecretRevealOpSchema`. **Do not** add it to
   `NoteSecretAnnounceOpSchema` (keep announce substance-free — it's `.strict()`).
3. **store.ts:** add `title: string | null` to `NoteRow`, `RawNoteRow`, the
   `NOTE_SELECT` column list, and `rowOf`. Extend:
   - `writeSharedNote(deps, body, attachments, title?)` — insert `title`; include
     `title` on the `note.share.add` op when present.
   - `writeSecretNote(deps, body, attachments, title?)` — insert `title` locally;
     the announce op carries **no** title.
   - `revealSecretNote` — include the row's `title` on the `note.secret.reveal` op.
   - (Title editing is out of scope for v1 — set at compose time. A later
     `note.edit`-style extension can add it.)
4. **compose-wiring.ts:** thread an optional `title` param through
   `submitNoteCompose` to `writeSharedNote`/`writeSecretNote`.
5. **projector.ts:** add `title` to the `note.share.add` INSERT and the
   `note.secret.reveal` UPDATE (guarded by the existing `revealed_at IS NULL`).
   Leave `note.secret.announce` unchanged.
6. **UI:**
   - `NotesCompose.tsx`: add an optional title `TextInput` (placeholder "Title
     (optional)") above the body; pass it in the `onSubmit` payload.
   - `NotesComposeRoute.tsx`: forward `title` into `submitNoteCompose`.
   - Add a tiny helper `displayTitle(note)` = `note.title ?? firstWords(note.body)`
     (first ~6 words / ~40 chars + "…", and a fallback like "Untitled" / the date
     when the body is null, e.g. an unrevealed secret). Use it in `NotesList`
     (row title) and `NotesDetail` (header).
7. **Tests:** update note-store tests, projector tests, and op round-trip tests for
   the new optional field; add a `displayTitle` unit test.

**Test (device).** Create a note without a title → list/detail show the first words.
Create one with a title → that shows. Secret note: partner sees the title only
after reveal.

---

## 11. Voice note: select audio output

**Complexity:** Spike + native module. **Not a JS-only change — keep off the cheaper
model until scoped.** **Files:** `screens/notes/AudioPlayer.tsx` + new native view.

**Finding.** `AudioPlayer` uses `expo-av` (`Audio.Sound`), which **does not expose
audio-output route selection** or a route list, and only sets
`Audio.setAudioModeAsync({ playsInSilentModeIOS: true })`. Letting the user choose
the output (speaker / earpiece / Bluetooth / AirPlay) requires native work:

- **iOS:** the App-Store-blessed control is `AVRoutePickerView` (the AirPlay/route
  button) opening the system route picker. No expo-av wrapper exists; needs a small
  native view (custom Expo native module / config plugin) or a maintained community
  package compatible with the pinned RN 0.74 / Expo. Even a plain speaker↔earpiece
  toggle needs native (`AVAudioSession.overrideOutputAudioPort`), which expo-av
  doesn't surface.
- **Android:** `MediaRouteButton` (MediaRouter) or rely on the system; also not in
  expo-av.

**Recommendation.** Treat this as a developer spike, not a ticket for a less-skilled
model:
1. Decide the mechanism: add an `AVRoutePickerView` (iOS) + MediaRoute equivalent
   (Android) as a small native view, **or** adopt a maintained library if one fits
   the pinned versions. Either needs a **dev client build** (won't work in Expo Go).
2. UI design (do this part now): a route/output button beside play/pause in
   `AudioPlayer` that invokes the system picker; no custom routing logic — let the
   OS picker handle device selection.
3. Then wire and verify on a physical device with a Bluetooth/AirPlay target.

If a quick interim is wanted, the only thing that's purely in our control with
expo-av is making sure playback isn't forced quiet (it already sets
`playsInSilentModeIOS`); actual output selection still needs the native picker
above.

---

## Decisions to confirm

These are choices I made so the plan is unambiguous; flag any you disagree with and
I'll revise:

- **#8 onboarding** → **Option A (connect-gated, with skips)**: pairing gates the
  Role/Categories/Safe-Word steps; skipping pairing auto-skips them (do those later
  in Settings). The literal Role→Categories→Connect order isn't technically possible
  without the heavier Option B (deferred-apply).
- **#10 titles** → title is optional, **synced with the body** (secret-note titles
  appear to the partner only on reveal), and the **default is derived from the first
  words at display time** (only explicit titles are stored). Title editing deferred.
- **#11 voice output** → exposed via the **system route picker** (native), not a
  custom earpiece/speaker toggle; flagged as needing a native module + dev build.
- **#6 role** → null stays unwritten but is **displayed/treated as neutral** (no
  auto-write), since the code already treats null === neutral.
