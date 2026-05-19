# The Secret Notebook — Phased Implementation Plan

## Context

The repository at `/home/user/secretnotebook` is a blank slate (only a README). The functional spec describes a **decentralized couple-centric** mobile app for paired partners to share intimate content, complete relationship prompts, earn points, and (eventually) anchor non-sensitive events on a blockchain. The architecture is deliberately hybrid: fantasy content stays encrypted on the two paired devices only; a small stateless service handles global post moderation; blockchain hooks expose verifiable events without ever uploading private content.

Because the scope is large, this plan is **phased**: a focused MVP first (Phase 1) to prove the core loop end-to-end, then moderation + popularity + safety hardening (Phase 2), then the blockchain abstraction + advanced safety (Phase 3). Each phase is independently shippable and reviewable.

## Decided tech stack

- **Mobile**: React Native 0.74+ (TypeScript), bare workflow with Expo dev client
- **Backend (moderation only)**: Node 20 + Fastify + Drizzle + Postgres 16 (Neon-managed)
- **Blockchain**: abstract `BlockchainAdapter` interface only — no chain wired in Phase 1/2
- **Storage**: SQLCipher-encrypted SQLite on device; relay server stores opaque E2EE ciphertext blobs only
- **E2EE**: Double Ratchet (Signal-style) for couple channel, X3DH for pairing, libsodium primitives

## Repository layout (pnpm + Turborepo monorepo)

```
secretnotebook/
├── apps/
│   ├── mobile/                 # React Native client
│   └── api/                    # Fastify moderation service
├── packages/
│   ├── shared-types/           # Zod schemas + TS types shared by mobile + api
│   ├── crypto/                 # X25519/Ed25519/AES-GCM/Argon2id wrappers, Safe Word KDF
│   ├── couple-protocol/        # CRDT + sync envelope format, Double Ratchet wrappers
│   ├── prompt-library/         # Seed JSON of relationship-deepening prompts
│   ├── eventbus/               # BlockchainAdapter interface (V3) + Noop/Local adapters
│   └── config-eslint/, config-tsconfig/
├── infra/
│   ├── db/                     # SQL migrations (drizzle-kit)
│   └── docker/                 # Local dev compose (postgres, relay)
└── docs/                       # ADRs, threat model, protocol spec
```

## Key libraries (locked early)

| Concern | Package |
|---|---|
| Encrypted SQLite | `op-sqlite` with SQLCipher build |
| Hot KV | `react-native-mmkv` (encryptionKey from Keychain) |
| Secure key storage | `react-native-keychain` |
| Biometrics | `expo-local-authentication` |
| BLE pairing | `react-native-ble-plx` |
| Crypto | `react-native-libsodium` (preferred) or `@noble/curves` + `@noble/hashes` |
| Double Ratchet | `@privacyresearch/libsignal-protocol-typescript` |
| Navigation | `@react-navigation/native` v7 native-stack |
| State | Zustand + TanStack Query |
| Forms | `react-hook-form` + Zod resolver |
| Screenshot block | `FLAG_SECURE` (Android), capture-detection + blur overlay (iOS) |
| Background sync | `react-native-background-fetch` |
| Testing | Jest + RNTL, Detox (E2E) |
| API server | Fastify 4, `@fastify/rate-limit`, Drizzle ORM |

---

## Phase 1 — MVP (the core loop)

### Deliverables
Two devices can pair over BLE with biometric confirmation, jointly define a Safe Word, browse a global post feed, save a post for the partner, complete + certify a relationship-deepening prompt, unlock one random saved post, **perform private 1–10 rating + mutual gratitude prompt, and both earn Couple Points**. This covers the full happy-path core loop (spec steps 1–6) end-to-end. Stateless posts API live. SQLCipher at rest. Safe Word re-auth on every cold start. No flagging, popularity, achievements, severing, or chain.

### Critical files to create
- `apps/mobile/src/features/pairing/state-machine.ts` — BLE + biometric + X3DH handshake state machine (load-bearing correctness)
- `apps/mobile/src/features/safeword/verifier.ts` — Argon2id verifier, constant-time compare, session lifecycle
- `apps/mobile/src/features/couple-channel/sync-engine.ts` — outbox, dedup, retry, CRDT merge
- `apps/mobile/src/features/prompts/assigner.ts` — pick a prompt from the library, assign to one partner
- `apps/mobile/src/features/saved-posts/random-unlocker.ts` — select one random not-yet-unlocked saved post per certified prompt
- `apps/mobile/src/features/roleplay/rating-flow.ts` — private 1–10 rating (never leaves couple channel, never on API/chain)
- `apps/mobile/src/features/roleplay/gratitude-screen.tsx` — mutual gratitude prompt UI; both sides must complete before points award
- `apps/mobile/src/screens/auth/SafeWordGate.tsx` — gate on every cold start
- `packages/couple-protocol/src/envelope.ts` — CRDT op format + Double Ratchet wrappers (the wire spec)
- `packages/crypto/src/safeword.ts` — Argon2id KDF, parameters tuned for mobile (m=64MB, t=3, p=1)
- `packages/crypto/src/handshake.ts` — X3DH triple-DH + root key derivation
- `apps/api/src/routes/posts.ts` — POST /v1/posts, GET /v1/posts, GET /v1/posts/:id
- `apps/api/src/auth/http-signature.ts` — Ed25519 over `METHOD|PATH|sha256(body)|timestamp`
- `infra/db/migrations/0001_init.sql` — `posts`, `devices` tables only

### Mobile local DB schema (SQLCipher)
```
profiles(id, display_name, public_bio, partner_private_bio, created_at)
couple(id, partner_a_pubkey, partner_b_pubkey, safeword_verifier, safeword_salt,
       channel_root_key_wrapped, paired_at, status)
session(id, opened_at, safeword_satisfied_at, expires_at)
post_cache(global_id, content_type, body, anon_author_id, fetched_at)
saved_post(id, global_post_id, saved_by_pubkey, saved_for_pubkey, created_at,
           unlocked_at NULL, unlock_prompt_id NULL)
prompt(id, library_key, title, body, assigned_to_pubkey, assigned_by_pubkey,
       state ENUM('assigned','completed','certified','expired'),
       completed_at, certified_at)
ledger_entry(id, kind ENUM('couple_points'), delta, reason, ref_id, created_at)
roleplay_session(id, enactor_pubkey, curator_pubkey, rating, started_at,
                 gratitude_prompt_id, gratitude_enactor_done_at,
                 gratitude_curator_done_at, ended_at)
sync_outbox(id, envelope, recipient_pubkey, attempts, next_attempt_at)
sync_seen(envelope_hash PK)
```

### Server schema (Postgres) — what the server IS allowed to know
```sql
posts (id uuid pk, content_type text, body text, body_hash bytea,
       anon_author bytea, created_at timestamptz, popularity int default 0);
devices (pubkey bytea pk, first_seen timestamptz, reputation int default 0);
```
Storing the full `body` plaintext on the server is acceptable for Phase 1 (posts are explicitly public/global). **Phase 2 optimization**: switch to a content-addressed scheme (`body_hash` + signed encrypted blob URL) so the moderation tier handles only metadata, not the post text itself.

**Explicitly NOT on server**: profiles, couple identity, Safe Word, saved posts, prompts, completions, ledger, points, ratings, gratitude, role-play.

### API surface (Phase 1)
All requests carry `X-Device-Pubkey` + `X-Signature`.
- `POST /v1/posts` → `{ id, createdAt }`
- `GET /v1/posts?cursor=&limit=` → `{ items, nextCursor }`
- `GET /v1/posts/:id` → `Post`
- `POST /v1/devices/register` → `{ ok }`
- `GET /v1/health` → `{ ok }`

### Pairing handshake (4.1)
1. Each device generates per-couple Ed25519 + X25519 keypairs (never leave device)
2. BLE advertise/scan; both screens show 6-digit code = `truncate(sha256(pubkey_A || pubkey_B), 3)`
3. Both users biometric-confirm the matching code
4. X3DH triple-DH → `root_key`
5. Both type Safe Word; each side derives `Argon2id(safeword, salt=root_key||"sw")` locally; verifiers exchanged over the just-established channel and compared
6. Initialize Double Ratchet with `root_key`; persist couple row; status `paired`

### Couple Channel (recommendation: encrypted-blob relay + Double Ratchet)
Rationale: pure libp2p fails on mobile (background suspension, NAT, battery); pure BLE forces proximity. A dumb relay storing ciphertext blobs keyed by a daily-rotated blinded recipient ID gives async delivery without the server holding decryptable couple data.

Envelope:
```
SyncEnvelope { v, recipientBlindedId, header(ratchet), ciphertext, sentAt }
recipientBlindedId = HMAC(couple_root, recipient_pubkey, day)
```
CRDT: per-entity LWW-register + add-only set for `saved_post` and `ledger_entry`. Writes are partitioned by author per entity type, so conflicts are trivial.

Relay endpoints (added at the end of Phase 1):
- `POST /v1/relay/inbox/:blindedId` (30-day TTL)
- `GET /v1/relay/inbox/:blindedId?since=`
- `DELETE /v1/relay/inbox/:blindedId/:envelopeId`

### Security architecture (Phase 1)
Key chain: `biometric unlock → keychain-sealed device_master → device_master unwraps {sqlcipher_key, ratchet_state}`. TLS pinning. PII-scrubbed Sentry. Logs ship only stack frames + anonymized device id. Safe Word never leaves device, never logged.

### Step-by-step build order

Hybrid sequence: build the **foundation (F0–F3)** strictly in order, then ship the **vertical slices (S1–S9)** — each slice is independently testable, demoable, and PR-sized.

#### Foundation

**F0 — Monorepo + tooling**
- Init pnpm workspace + Turborepo (`pnpm-workspace.yaml`, `turbo.json`)
- Scaffold `packages/config-tsconfig` (base + node + react-native presets) and `packages/config-eslint`
- Wire `apps/mobile`, `apps/api`, `packages/{shared-types,crypto,couple-protocol,prompt-library}` placeholders with `package.json` + tsconfig extending the shared base
- GitHub Actions workflow: `pnpm install` → `pnpm -w lint` → `pnpm -w typecheck` → `pnpm -w test` on every PR
- Husky + lint-staged pre-commit (eslint + prettier on staged files)
- **Acceptance**: clean repo, `pnpm install && pnpm -w lint && pnpm -w typecheck` pass with no source files yet
- **Depends on**: —

**F1 — Shared types + crypto primitives**
- `packages/shared-types`: install Zod; export `PostSchema`, `PostInputSchema`, `DeviceRegisterSchema`, `SyncEnvelopeSchema` (envelope schema lives here so server can validate shape without reading content)
- `packages/crypto`: typed wrappers around `react-native-libsodium` (X25519, Ed25519, XChaCha20-Poly1305, Argon2id, HKDF, HMAC); Node-side polyfill for unit tests
- `packages/crypto/src/safeword.ts`: `deriveVerifier(safeword, salt)` using Argon2id (m=64MB, t=3, p=1); `verify(input, stored)` with constant-time compare
- `packages/crypto/src/handshake.ts`: X3DH triple-DH → 32-byte `root_key`
- Jest KAT tests against published vectors for every primitive; verifier round-trip + mismatch tests
- **Acceptance**: `pnpm --filter crypto test` green; coverage ≥90% for `packages/crypto`
- **Depends on**: F0

**F2 — API service skeleton**
- `apps/api`: Fastify 4 + `@fastify/sensible` + `fastify-type-provider-zod` + Drizzle ORM + `pg` driver
- `infra/db/migrations/0001_init.sql` for `posts` + `devices`; Drizzle schema reflects it
- `apps/api/src/auth/http-signature.ts`: middleware that verifies `X-Device-Pubkey` (Ed25519) signed `METHOD|PATH|sha256(body)|timestamp`; rejects timestamp drift > 5 min
- `GET /v1/health` route + Fastify-inject integration test (signed and unsigned)
- `infra/docker/docker-compose.yml`: Postgres 16 + the api service for local dev
- **Acceptance**: `pnpm --filter api dev` boots; `curl /v1/health` returns 200; signed request passes, unsigned fails 401
- **Depends on**: F0, F1

**F3 — Mobile app skeleton + SQLCipher**
- `apps/mobile`: Expo bare workflow + RN 0.74 + TypeScript; `@react-navigation/native` v7 native-stack; Zustand + TanStack Query
- Install native modules: `op-sqlite` (SQLCipher build), `react-native-mmkv`, `react-native-keychain`, `expo-local-authentication`, `react-native-ble-plx`, `react-native-libsodium`; verify iOS Pod + Android Gradle integration builds clean on both
- `apps/mobile/src/db/migrations/` runner; Phase-1 migrations create every table from the Mobile local DB schema above (including `roleplay_session`)
- Key-chain wrapper: on first launch, generate `device_master` (32 bytes), seal behind biometric via `react-native-keychain`; derive SQLCipher key as `HKDF(device_master, "sqlcipher")`
- Navigation skeleton: `RootStack` with `Onboarding` / `Main` switch driven by Zustand `couple.status`
- Detox config + first smoke test (`app launches`)
- **Acceptance**: app launches in iOS + Android simulators; `sqlite3` CLI cannot open the DB file; Detox smoke test green
- **Depends on**: F0, F1

#### Vertical slices

**S1 — Pairing**
- `apps/mobile/src/features/pairing/state-machine.ts`: states `idle → scanning → code_shown → biometric → handshake → safeword_required`; use XState or a typed reducer
- BLE adapter (`packages/couple-protocol/src/transport/ble.ts`) with `react-native-ble-plx`; pluggable mock for unit tests
- Compute 6-digit verification code = `truncate(sha256(pubkey_A || pubkey_B), 3)`; show on both screens
- Mutual biometric confirmation via `expo-local-authentication`; if mismatch, restart
- X3DH derives `root_key`; persist `couple` row with `status='awaiting_safeword'`
- Screen: `screens/onboarding/PairWithPartner.tsx`
- **Tests**: pairing harness with two in-process devices using BLE mock — full state machine completes and stores matching `couple` rows; Detox `pair` step on simulators
- **Acceptance**: two devices pair; both have identical `root_key` (verified via shared HMAC); couple row exists with same `couple.id`
- **Depends on**: F3

**S2 — Safe Word & session**
- `features/safeword/verifier.ts`: each side derives verifier locally; exchange via the freshly established couple channel; compare constant-time; on match, persist `safeword_verifier` + `safeword_salt`, advance `couple.status='paired'`
- Screens: `onboarding/DefineSafeWord.tsx` (joint entry with partner-ready indicator), `auth/SafeWordGate.tsx` (gate on cold start, on background >60s, on screen-lock release)
- `features/safeword/session.ts`: Zustand in-memory `session` (never persisted), TTL 30 min idle
- **Tests**: unit — matching word produces identical verifiers, mismatched restarts; E2E — cold launch shows gate, correct entry passes, wrong rejects 3× and locks for 30s
- **Acceptance**: Safe Word required on every cold start; no session token in DB or MMKV
- **Depends on**: S1

**S3 — Global posts feed (server + mobile)**
- Server: `apps/api/src/routes/posts.ts` (POST/GET list/GET id) + `routes/devices.ts` (POST register); rate limit by device pubkey via `@fastify/rate-limit`
- Mobile API client: TanStack Query hooks, signs every request with device Ed25519 key
- Screens: `feed/GlobalFeed.tsx` (infinite scroll + pull-to-refresh), `feed/SubmitPost.tsx` (text or link, content-type radio), `feed/PostDetail.tsx`
- `post_cache` write-through on every fetch
- **Tests**: server integration for each endpoint incl. signature rejection + dedup-by-`body_hash`; mobile component test for SubmitPost form; manual cross-simulator submission visible in feed
- **Acceptance**: submit on A → appears in feed on B within one refresh; rate limit returns 429 after threshold
- **Depends on**: F2, F3, S2

**S4 — Couple Channel (relay + sync engine)**
- Server: `apps/api/src/routes/relay.ts` (`POST/GET/DELETE /v1/relay/inbox/:blindedId`), 30-day TTL enforced by cron in `apps/api/src/cron/relay-gc.ts`
- `packages/couple-protocol/src/envelope.ts`: `SyncEnvelope` Zod schema; `blindedId(couple_root, recipient_pubkey, day) = HMAC(couple_root, recipient_pubkey || day)`
- `packages/couple-protocol/src/ratchet.ts`: Double Ratchet wrappers (init from `root_key`, encrypt/decrypt CRDT ops)
- `apps/mobile/src/features/couple-channel/sync-engine.ts`: outbox table writer, periodic relay poll (foreground polling + `react-native-background-fetch`), envelope dedup via `sync_seen`
- CRDT merge: per-entity LWW for fields, add-only set for `saved_post` and `ledger_entry`
- **Tests**: two-device integration with fake relay clock — writes on A appear on B in one poll cycle; replays deduped; out-of-order envelopes still converge to identical state; property tests with `fast-check`
- **Acceptance**: arbitrary write on one device is consistently visible on the other; server cannot decrypt any envelope (verified by attempting decryption with wrong key in test)
- **Depends on**: F2, S2

**S5 — Save-for-Partner**
- Mobile: "Save for partner" action on `PostDetail` → writes `saved_post` row locally (`saved_by_pubkey=me`, `saved_for_pubkey=partner`, `unlocked_at=NULL`) + enqueues sync envelope
- Recipient screens: `couple/SavedByYou.tsx` (your own saves with status) and `couple/SavedForYou.tsx` (locked-count tile only — actual post hidden until unlocked)
- SavedForYou CTA: "complete a prompt to unlock one"
- **Tests**: save on A → `saved_post` row on B (still locked, body not fetched); E2E covers the save action; permission test — A cannot save for someone they're not paired with
- **Acceptance**: locked count on recipient's screen increments after sync
- **Depends on**: S3, S4

**S6 — Prompts (assignment + certification)**
- `packages/prompt-library/src/seed.json`: ~30 seed prompts each `{key, title, body, suggestedAssignee: 'either'|'curator'|'enactor'}`; assignee is a hint only
- `features/prompts/assigner.ts`: weighted-random selection avoiding immediate repeats; writes `prompt` row with `state='assigned'`, `assigned_to_pubkey`, `assigned_by_pubkey`
- Screens: `prompts/PromptList.tsx` (active prompts assigned to you), `prompts/ActivePrompt.tsx` (mark "I did it"), `prompts/CertifyCompletion.tsx` (partner side — "I confirm they completed it" button → `state='certified'`)
- All transitions write through the couple channel
- **Tests**: completing without partner certification leaves prompt at `completed` (not `certified`); only the non-assignee partner can certify; race test — concurrent certify + complete settles deterministically
- **Acceptance**: a prompt cannot reach `certified` without both sides' actions
- **Depends on**: S4

**S7 — Random unlock**
- `features/saved-posts/random-unlocker.ts`: on `prompt.state` transition to `certified`, atomically pick one random `saved_post` where `unlocked_at IS NULL AND saved_for_pubkey = assignee_of_prompt`, set `unlocked_at = now()`, `unlock_prompt_id = prompt.id`, enqueue sync envelope
- Recipient UI: notification ("a post unlocked"); unlocked tile moves into `SavedForYou`; opening it fetches the body from the global feed; Safe Word gate enforced on view
- Edge: zero unlockable posts — prompt still credits points but UI shows "ask your partner to save more"
- **Tests**: certifying one prompt unlocks exactly one post (not zero, not two); concurrent certifications on two devices result in two distinct posts unlocked (CRDT add-only set semantics); Safe Word gate blocks view until satisfied
- **Acceptance**: exactly-one-unlock invariant holds across concurrent merges
- **Depends on**: S5, S6, S2

**S8 — Rating + gratitude + Couple Points**
- `features/roleplay/rating-flow.ts`: opens after recipient taps "I tried it" on an unlocked post; curator privately enters 1–10; written to `roleplay_session.rating` only — **never sent to API, never in events**
- `features/roleplay/gratitude-screen.tsx`: pulls a gratitude prompt from `prompt-library`; both sides must complete and tap "done"; sets `gratitude_enactor_done_at` / `gratitude_curator_done_at`
- `features/ledger/couple-points.ts`: accrual rules — prompt certification = +10, save-for-partner = +2, completed role-play loop (both gratitude done) = +25; writes `ledger_entry` rows; syncs via couple channel
- `screens/couple/CoupleHome.tsx`: Couple Level (derived view over `ledger_entry`) + recent activity list
- **Tests**: rating never appears in any sync envelope payload sent to the API (intercept relay POST in test); both sides see matching `ledger_entry` rows after gratitude; CRDT merge resolves duplicate writes idempotently
- **Acceptance**: full loop completion adds the same point totals on both devices
- **Depends on**: S4, S7

**S9 — End-to-end happy-path validation**
- Detox spec covering the Phase 1 verification flow (pair → Safe Word → submit + save → complete + certify prompt → unlock → view → enact → rate → gratitude → points)
- Security smoke: SQLCipher unreadable by `sqlite3` CLI; `FLAG_SECURE` on every couple-content screen on Android; biometric required after backgrounding
- Sentry PII-scrubber unit test with sample payloads
- Manual internal build distribution (TestFlight + Android internal track)
- **Acceptance**: green Detox run on iOS + Android simulators in CI; happy path walked through on physical devices by two testers
- **Depends on**: S1–S8

#### Dependency graph (at a glance)
```
F0 → F1 → F2 ↘
          ↘ F3 → S1 → S2 → S3 → S5 ↘
                         ↘ S4 ↗   ↘
                              S6 → S7 → S8 → S9
```

### Phase 1 testing
- Unit (Jest): crypto KAT vectors, CRDT merge, Safe Word KDF, ledger math
- Integration: two-simulator pairing harness (BLE mocked at adapter), relay sync with fake clock
- E2E (Detox): pair → Safe Word → submit post → save for partner → complete prompt → certify → unlock
- Security smoke: SQLCipher file unreadable by sqlite3 CLI, `FLAG_SECURE` on Android, biometric required after background

### Phase 1 risks / open questions
- Safe Word recovery if both forget — acceptable as "must re-pair and lose ledger"?
- iOS BLE peripheral background limits may force foreground-only pairing UI — acceptable?
- Anonymous spam control beyond per-device rate limit — proof-of-work? Invite codes?
- App Store policy: 17+ rating + intimate-content policy doc before submission

---

## Phase 2 — V2 (moderation, popularity, safety hardening)

### Deliverables
- Flagging UI + "hidden by default" rendering for flagged posts
- **Partner-visible "flagged posts saved" counter shown in the profile view** (the only cross-user visibility into a partner's global activity, per spec 4.2 / 4.9)
- Popularity Points reconciled into the **author's local profile ledger only** — Popularity Points are **author-scoped and never enter the Couple Ledger** (Couple Points and Popularity Points are tracked separately as the spec requires); deltas are delivered via k-anonymous aggregation
- Achievements engine with **public/private visibility feature flag** per achievement (private = couple-only; public = eligible for V3 export)
- **Low-gamification toggle** in settings — when enabled, suppresses points UI, leaderboard, and achievement notifications without disabling the underlying ledger
- Screenshot blocking (Android `FLAG_SECURE` prevention, iOS detection + partner notification)
- Severing with mutual confirmation + 7-day grace + deterministic wipe

### Critical files to add
- `apps/mobile/src/features/moderation/flag-dialog.tsx`
- `apps/mobile/src/features/moderation/flagged-saves-counter.ts` — increments local `flagged_view_log` and syncs to partner only
- `apps/mobile/src/screens/profile/PartnerProfileView.tsx` — surfaces partner's flagged-saves count
- `apps/mobile/src/features/popularity/reconciler.ts` — pulls signed popularity deltas, writes into **author's profile ledger** (NOT the couple ledger)
- `apps/mobile/src/features/severing/state-machine.ts` — `none → requested → mutually_confirmed → grace(7d) → severed`
- `apps/mobile/src/features/severing/wipe.ts` — delete + zeroize ratchet + rotate SQLCipher key + vacuum
- `apps/mobile/src/features/achievements/engine.ts` — triggers on Phase 1 loop completion + Phase 2 events
- `apps/mobile/src/features/settings/low-gamification-toggle.tsx`
- `apps/api/src/routes/flags.ts`, `apps/api/src/routes/popularity.ts`, `apps/api/src/routes/relay.ts`

### Server schema additions
```sql
flags(id, post_id, reporter, reason ENUM, detail, created_at, UNIQUE(post_id, reporter));
post_saves_anon(post_id, saver_anon, day, count, PK(post_id, saver_anon, day));
popularity_delta(id, anon_author, delta, reason ENUM('saved','viewed'), created_at);
-- posts gains flag_count (denormalized, trigger-maintained)
```
Popularity deltas are batched (hourly aggregation, k-anonymity threshold of 3 saves) before delivery to authors.

### API additions
- `POST /v1/posts/:id/flag` (one flag per reporter per post)
- `GET /v1/posts/:id` now returns `flagCount`, `flagged`, `topReasons`
- `GET /v1/posts?includeFlagged=false` (default hides flagged)
- `POST /v1/posts/:id/save-signal` (pseudonym + post id + day-bucket; drives popularity)
- `GET /v1/popularity/me?since=` (signed pull)
- Relay endpoints formalized (see Phase 1)

### Mobile local schema additions
- `flagged_view_log(post_id, opened_at)` — drives partner-visible flagged-saves counter
- `achievement(id, key, kind ENUM('private','public'), unlocked_at)`
- `author_ledger(id, kind ENUM('popularity_points'), delta, reason, ref_id, created_at)` — **separate from `ledger_entry`** which holds Couple Points only
- `settings(key, value)` — including `low_gamification_enabled`

Note: `roleplay_session(id, enactor_pubkey, curator_pubkey, rating, started_at, gratitude_prompt_id, ended_at)` was introduced in Phase 1 alongside the rating + gratitude flow.

### Severing wipe (deterministic)
On `severed`: delete all couple-scoped rows → zeroize ratchet state → drop keychain entries → rotate SQLCipher master key (write-then-vacuum so old pages are unrecoverable). Either side can cancel during the 7-day grace.

### Phase 2 testing
- CRDT property tests with severing tombstones (no resurrection bugs)
- Adversarial moderation: cannot flag twice, cannot self-flag (drop where `reporter == anon_author`), per-device rate limit
- Forensic test: SQLite file snapshot pre/post severing shows zeroized pages
- Role-play privacy: ratings never sent to API, never in events

### Phase 2 risks / open questions
- Flag-brigading heuristic for "hidden by default" — e.g., `flag_count >= 3 AND flag_count / max(views,1) >= 0.05`. Product call needed
- iOS cannot prevent screenshots — partner notification as the control: document explicitly
- Popularity correlation attacks even with rotated `saver_anon` — k-anonymity batching mitigates

---

## Phase 3 — V3 (blockchain abstraction, advanced safety)

### Deliverables
`BlockchainAdapter` interface + three reference adapters (`NoopAdapter`, `LocalLogAdapter`, `EvmAdapter` stub). Public achievement export with Merkle proofs. Panic wipe (long-press + biometric). Duress Safe Word (decoy state). Per-screen re-auth for sensitive views. Optional Tor/proxy transport feasibility study.

### Critical files to add
- `packages/eventbus/src/adapter.ts` — interface definition (see below)
- `packages/eventbus/src/adapters/noop.ts`, `local-log.ts`, `evm-stub.ts`
- `packages/eventbus/src/payload-schemas.ts` — Zod allowlist gates per event type (rejects fantasy content / Safe Word / gratitude)
- `apps/mobile/src/features/safeword/duress.ts` — second verifier + decoy-mode boot
- `apps/mobile/src/features/safety/panic-wipe.ts`
- `apps/mobile/src/features/achievements/public-export.ts` — Merkle proof generator

### BlockchainAdapter interface
```ts
export type EventType =
  | 'point_award' | 'popularity_award' | 'prompt_completion'
  | 'achievement_unlock' | 'confirmed_action';

export interface BlockchainEvent {
  type: EventType;
  coupleHash: string;            // HMAC(couple_root, "chain") — not reversible
  occurredAt: number;
  payload: Record<string, unknown>;  // schema-validated, sensitive fields forbidden
  nonce: string;
  signature: string;             // Ed25519 over canonical JSON
}

export interface BlockchainAdapter {
  readonly id: string;
  readonly capabilities: { onChain: boolean; supportsProofs: boolean;
                           costEstimateUsd?: (e: BlockchainEvent) => Promise<number> };
  recordEvent(e: BlockchainEvent): Promise<{ txRef?: string; queued: boolean }>;
  verifyEvent(ref: string): Promise<{ valid: boolean; event?: BlockchainEvent }>;
  exportProof(e: BlockchainEvent): Promise<Uint8Array>;
}
```
Off-chain by default (`NoopAdapter` in production). Per-event opt-in with cost disclosure. Schema gate rejects any sensitive field at the boundary — fantasy content / Safe Word / gratitude cannot pass validation.

### Advanced safety
- **Panic wipe**: configurable gesture (long-press Safe Word field + biometric) → Phase 2 wipe routine immediately, no partner confirmation, optionally synthesizing a fresh-install state
- **Duress Safe Word**: second verifier; matches → app boots into decoy state with empty feed; records duress event to couple-only log
- **Per-screen re-auth**: biometric prompt before opening any unlocked post
- **Transport hardening**: feasibility check for Orbot (Android) / `arti-mobile` (iOS) bridge for relay traffic

### Phase 3 risks / open questions
- Chain choice (EVM L2 vs Solana vs Polkadot) — user input needed before `EvmAdapter` becomes more than a stub
- Gas/fees — user wallet integration via `@walletconnect/react-native-modal`?
- Public-achievement timing correlation may identify couple — k-anonymity batching needed here too
- Duress mode must be byte-identical to fresh install (snapshot diff test required)
- App Store policy on on-chain features in intimacy apps — keep behind opt-in feature flag

---

## Cross-phase threat model (summary)

| Threat | Mitigation |
|---|---|
| Lost/stolen device | SQLCipher + biometric-sealed key; Safe Word every session; panic wipe (V3) |
| Server compromise | No couple data on server; relay sees only ciphertext + blinded IDs; TLS pinning |
| Partner coercion | Duress Safe Word (V3); severing with grace period; partner-visible flagged counter |
| Partner uses flagged-saves counter as a coercion signal | Counter is per-spec partner-visible accountability, not punitive; in-app copy frames it neutrally; low-gamification toggle suppresses related notifications; severing remains available without penalty |
| Screenshot leak | `FLAG_SECURE` Android; iOS detection + partner notification + blur on background |
| Correlation via popularity | Daily-rotated `saver_anon` + k-anonymity batching of deltas |
| Replay of sync envelopes | Double Ratchet counters + `sync_seen` dedup |
| Identity link via chain | HMAC `coupleHash`, per-event opt-in, payload allowlist |

---

## Verification

### Phase 1 end-to-end test
1. `pnpm install && pnpm -w build`
2. `pnpm --filter api dev` (Postgres via `infra/docker/docker-compose.yml`)
3. Launch two iOS simulators / Android emulators via Detox: `pnpm --filter mobile e2e`
4. Detox spec walks: pair (BLE mocked) → Safe Word setup → both submit a post → save partner's post → assigned prompt completes → partner certifies → unlock one random post → view post (Safe Word gate) → enactor marks action done → curator submits private 1–10 rating → both complete gratitude prompt → Couple Points appear in both ledgers
5. Background app on simulator A → reopen → Safe Word gate must reappear
6. Manual: open SQLCipher file with `sqlite3` CLI → must fail to open

### Phase 2 additions
- Detox: flag a post, confirm "hidden by default", open it anyway, confirm partner sees flagged-saves counter increment
- Forensic test script: snapshot SQLite file → trigger severing → after grace expires confirm zeroized pages
- Property tests (`fast-check`) on CRDT merges under severing tombstones
- **Full Core Flow E2E** (must pass before Phase 2 GA): pair → Safe Word → submit/save post → flag a different post and open it → complete + certify prompt → unlock saved post → view (Safe Word gate) → enactor performs simulated action → curator rates 1–10 → both complete gratitude prompt → Couple Points + achievement unlock visible to both → trigger severing → wait through (fake-clock-accelerated) 7-day grace → confirm full wipe on both devices

### Phase 3 additions
- Adapter conformance suite must pass for all three adapters (round-trip `record → verify → exportProof`)
- Fuzz `payload-schemas.ts` with sensitive-field corpora — must reject 100%
- Snapshot diff between fresh install and duress boot must be empty

### Continuous
- Semgrep + osv-scanner in CI
- MobSF run per release
- External pentest before V2 and V3 GA
- `docs/THREAT_MODEL.md` updated each phase
- `docs/CORE_FLOW_MAPPING.md` — one-page mapping from each step of the spec's logical sequence (§5) to the phase that implements it; created at start of Phase 1 and updated whenever scope shifts between phases

### Core flow mapping (preview — full doc lives in `docs/CORE_FLOW_MAPPING.md`)

| Spec step (§5) | Phase |
|---|---|
| 1. Pair → define Safe Word | 1 |
| 2. Submit/browse Posts globally → flag if needed | Submit/browse: 1 · Flag: 2 |
| 3. Save Posts for partner | 1 |
| 4. Complete + certify prompt → unlock random partner Post | 1 |
| 5. View Post (after Safe Word) → enact in real life | 1 |
| 6. Rate + gratitude → earn Couple Points + possible achievement | Rate + gratitude + Couple Points: 1 · Achievements: 2 |
| 7. (Optional) Bridge events to blockchain | 3 |
| 8. Repeat. If severed → all couple data deleted | 2 |
