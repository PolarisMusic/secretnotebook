# Secret Notebook

> A decentralized couple-centric mobile app for two paired partners to share intimate content, complete relationship-deepening prompts, earn shared points, and (eventually) anchor non-sensitive events on a blockchain.

**Status:** Phase 1.5 in progress. Foundation (F0–F3c) + the pairing / Safe Word / global-feed / connection-channel-sync slices are shipped. The Phase-1 role-play / prompts / save-for-partner / unlocked-saved loop has been retired (R0); the connection-channel surface is now shared + secret **notes** (R2), per-note **publish** (R3), per-partner **role** on the connection (R4), **IAP-gated publish** (R5), and couple-only **media attachments** — images + voice notes, end-to-end encrypted (R6). See [Phased plan](#phased-plan) for the rest, and [`apps/mobile/RUNBOOK.md`](./apps/mobile/RUNBOOK.md) for the current end-to-end verification walk.

> **Note on staleness in this README:** the "How it works" + "Sync model" sections below describe the Phase-1 vision and are accurate for pairing / Safe Word / global feed / connection-channel transport. The Phase-1.5 refactor (R0–R5) replaced what used to come after "save a post for your partner" — those sections still reference the deleted surface. The sources of truth for the current model are:
>
> - **Schema:** `apps/mobile/src/db/migrations/` (migrations 001–014)
> - **CRDT ops:** `packages/connection-protocol/src/crdt/op.ts`
> - **Media:** `packages/crypto/src/chunked-aead.ts` + the opaque `/v1/blobs` store in `apps/api`; acceptance in `apps/mobile/tests/attachments.test.ts`
> - **End-to-end acceptance:** `apps/mobile/tests/full-loop.test.ts`
> - **Operator walk:** `apps/mobile/RUNBOOK.md`

---

## Purpose

The Secret Notebook is built for the two people in a romantic relationship — not for an audience, not for a feed of mutuals, not for an algorithm. The product principle is the opposite of social media: **almost everything the app stores about a couple stays on the couple's two devices**, and even the things that don't (a small global posts board, a relay for sync traffic) are designed so the server cannot decrypt anything that matters.

What the spec asks for:

- Two partners pair their phones over BLE with mutual biometric confirmation.
- They jointly choose a Safe Word that gates every cold start.
- They browse a global, anonymous board of posts contributed by other couples and pick ones to "save for" their partner.
- They get assigned relationship-deepening prompts; completing + certifying a prompt unlocks one of the partner's saved posts.
- Both rate the resulting real-life interaction privately, complete a mutual gratitude prompt, and earn shared Couple Points.

The threat model the architecture takes seriously:

| Concern                | What the app does about it                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Lost / stolen device   | SQLCipher-encrypted SQLite, biometric-sealed key, Safe Word every session, panic-wipe (Phase 3)                   |
| Server compromise      | No couple data on the server; relay sees only ciphertext + daily-rotated blinded recipient IDs                    |
| Partner coercion       | Duress Safe Word (Phase 3), severing with grace period (Phase 2), partner-visible flagged-saves counter (Phase 2) |
| Replay of sync traffic | Ratchet counters + content-bound `sync_seen` dedup                                                                |
| Identity linkage       | HMAC blinded recipient IDs that rotate every UTC day                                                              |

The canonical reference for everything — phase plan, schemas, threat model, acceptance criteria per slice — is [`implementation-details.md`](./implementation-details.md).

---

## How it works (Phase 1 happy path)

1. **Pair** over BLE. Both phones generate per-couple X25519 + Ed25519 keys, exchange them, derive the same shared `root_key` via X3DH, and biometric-confirm a 6-digit code computed from both pubkeys.
2. **Define a Safe Word.** Each side runs Argon2id locally with a deterministic per-couple salt; the verifiers are byte-identical on both sides without an exchange. The couple row promotes to `paired`.
3. **Browse the global feed.** Posts are submitted to a small Fastify service, signed with the device's Ed25519 key. The feed shows newest-first, infinite-scroll.
4. **Save a post for your partner.** Writes a local `saved_post` row + enqueues a `saved_post.add` CRDT op onto the couple-channel sync engine. The partner's device pulls it through the relay, decrypts via the ratchet, projects it into their `saved_post` table. They see a locked count tick up.
5. **Complete + certify a prompt.** _(S6, in progress)_ The assigner picks a prompt from a seed library; both partners contribute to advance it through assigned → completed → certified.
6. **Unlock a random saved post.** _(S7, planned)_ On certification, atomically pick one not-yet-unlocked `saved_post` for the assignee.
7. **Rate + gratitude → Couple Points.** _(S8, planned)_ The 1–10 rating never leaves the couple channel and never reaches the server. Both completing the gratitude prompt awards +25 Couple Points.

---

## Architecture

### Two-tier by design

- **The couple's two phones** hold everything sensitive: profiles, the couple row, Safe Word verifier, saved posts, prompts, ledger, role-play, ratings, gratitude. All in a SQLCipher-encrypted SQLite file whose key is sealed in the platform keychain behind biometric auth.
- **The Fastify service** holds two things: (a) a global posts board (text + link content, explicitly public) and (b) a "dumb relay" of opaque ciphertext envelopes addressed to a daily-rotated blinded recipient ID. The server can decrypt none of the relay traffic — that requires the couple's `root_key`, which never leaves either device.

The blockchain abstraction in Phase 3 layers cleanly on top: an `EventBus` adapter takes the _non-sensitive_ parts of completion events (point awards, achievement unlocks) and optionally anchors them on-chain. Sensitive payloads can't pass the schema-allowlist gate.

### Cryptography in one picture

```
biometric unlock
    └─► keychain-sealed device_master (32 random bytes, generated on first launch)
            ├─► HKDF "secretnotebook/sqlcipher/v1"        ─► SQLCipher master key
            ├─► HKDF "secretnotebook/device-signing/v1"    ─► Ed25519 keypair (API request signing)
            └─► HKDF "secretnotebook/safeword-salt/v1"     ─► Argon2id salt (Safe Word verifier)

X3DH pairing handshake (per couple, separate from device_master)
    └─► 32-byte root_key, shared between both phones
            ├─► HKDF "secretnotebook/couple-channel/a->b/v1" ─► A's sending / B's receiving chain key
            ├─► HKDF "secretnotebook/couple-channel/b->a/v1" ─► B's sending / A's receiving chain key
            └─► HMAC "secretnotebook/blinded-recipient/v1" || pubkey || day → 32-byte blinded relay ID
```

The couple channel is a symmetric Signal-style chain ratchet — forward secrecy (compromising a chain key after the fact does not reveal earlier message keys) without the Diffie-Hellman half. The DH ratchet is deferred to Phase 2; the wire header already carries a version byte to swap it in.

### Sync model

```
PostDetail              SyncEngine                     Relay                SyncEngine             SavedForYou
"Save for partner"  ─►  enqueue (sync_outbox)
                        ratchetEncrypt
                        saveRatchet (couple_ratchet)
                        postEnvelope        ─────────► relay_inbox
                                                       (blinded_id, header, ciphertext)
                                                                            listEnvelopes ◄────────
                                                                            ratchetDecrypt
                                                                            sync_seen check
                                                                            applyCrdtOp (saved_post)
                                                                            saveRatchet
                                                                            deleteEnvelope ───────►
                                                                                                   summariseSavedForMe
                                                                                                   "Locked: 1"
```

Idempotency is structural at three layers: the relay-side `sync_seen` table dedups inbound envelopes by `sha256(header‖ciphertext)`; the projector uses `INSERT OR IGNORE` on the row's UUID; the ratchet rejects replays by counter. A `useSyncTicker` hook in `App.tsx` drives `flush() + pull()` every 15 s while the app is foregrounded.

### Repository layout

```
secretnotebook/
├── apps/
│   ├── mobile/                  # React Native + Expo bare workflow, RN 0.74
│   │   ├── src/
│   │   │   ├── db/              # SQLCipher migration runner + executor abstraction
│   │   │   ├── features/
│   │   │   │   ├── api/         # signed fetch wrapper, TanStack Query hooks, post cache
│   │   │   │   ├── boot/        # boot pipeline + Zustand boot store
│   │   │   │   ├── connection-channel/  # sync engine, ratchet store, CRDT projector
│   │   │   │   ├── connection/  # per-partner role store (R4)
│   │   │   │   ├── iap/         # entitlement cache + receipt validator (R5)
│   │   │   │   ├── notes/       # shared + secret notes, publish (R2 + R3)
│   │   │   │   ├── attachments/ # couple-only media: chunked-AEAD pipeline + blob fetch (R6)
│   │   │   │   ├── pairing/     # BLE state machine, X3DH orchestrator, connection-row persistence
│   │   │   │   └── safeword/    # Argon2id verifier, session, lockout, background-lock policy
│   │   │   ├── navigation/      # RootStack / OnboardingStack / MainStack
│   │   │   ├── screens/         # presentational screens + *Route.tsx wiring
│   │   │   ├── security/        # keychain wrapper, device_master + SQLCipher key derivation
│   │   │   └── state/           # connection status, session, etc. (Zustand)
│   │   └── tests/               # Jest, includes two-device integration tests
│   └── api/                     # Fastify 4 + Drizzle + Postgres 16
│       ├── src/
│       │   ├── auth/            # Ed25519 HTTP-signature middleware
│       │   ├── db/              # Drizzle schema + pg client
│       │   ├── routes/          # /v1/health, /v1/posts, /v1/devices, /v1/relay/inbox/:blindedId, /v1/blobs
│       │   └── storage/         # PostsStore / DevicesStore / RelayStore + Drizzle impls
│       └── tests/               # Integration tests with in-memory stores via app.inject()
├── packages/
│   ├── crypto/                  # libsodium wrappers: X25519/Ed25519/AEAD/Argon2id/HKDF/HMAC/SHA-256/base64
│   ├── connection-protocol/     # CRDT op shapes, ratchet, blinded ID, pairing transport interface
│   ├── shared-types/            # Zod schemas (Post, SyncEnvelope, Device, relay request/response)
│   ├── config-eslint/           # Shared flat ESLint preset
│   └── config-tsconfig/         # Shared base / node / react-native tsconfig presets
└── infra/
    ├── db/migrations/           # Postgres SQL migrations (server side)
    └── docker/                  # docker-compose.yml + api Dockerfile
```

### Tech stack (locked)

| Concern                   | Choice                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Mobile                    | React Native 0.74 (TypeScript), Expo bare workflow                                                                              |
| Encrypted local DB        | `op-sqlite` with SQLCipher build                                                                                                |
| Secure key storage        | `react-native-keychain` (biometric-gated)                                                                                       |
| Biometrics                | `expo-local-authentication`                                                                                                     |
| BLE pairing               | `react-native-ble-plx` (central) — peripheral library TBD                                                                       |
| Crypto                    | `react-native-libsodium` on device, libsodium-wrappers-sumo in Node tests                                                       |
| Couple-channel encryption | Symmetric chain ratchet over libsodium primitives (Phase 1); DH half in Phase 2                                                 |
| Note media (R6)           | Chunked XChaCha20-Poly1305 on device; opaque `/v1/blobs` ciphertext store; `expo-image-picker` + `expo-av` + `expo-file-system` |
| Navigation                | `@react-navigation/native` v7 native-stack                                                                                      |
| State                     | Zustand for app state, TanStack Query for server reads                                                                          |
| API server                | Fastify 4 + `@fastify/rate-limit` + `fastify-type-provider-zod` + Drizzle ORM + Postgres 16                                     |
| Build                     | pnpm workspace + Turborepo                                                                                                      |
| Testing                   | Jest + ts-jest (Node), Detox (E2E, Mac runbook)                                                                                 |

---

## Local development

### Prerequisites

- Node 20
- pnpm 10 (the lockfile is pinned to pnpm 10)
- Docker (for the Postgres-backed local API)
- Mac toolchain with Xcode + Android Studio for any on-device verification

### Bootstrap

```sh
pnpm install
pnpm -w lint
pnpm -w typecheck
pnpm -w build
pnpm -w test
```

All five commands are wired into the CI workflow at `.github/workflows/ci.yml` and run on every PR.

### Run the API

```sh
docker compose -f infra/docker/docker-compose.yml up -d postgres
pnpm --filter @secretnotebook/api dev
# in another shell:
curl http://localhost:3000/v1/health
# {"ok":true,"service":"secretnotebook-api","version":"0.0.0"}
```

The `.env.example` under `apps/api/` documents every knob: `DATABASE_URL`, `PORT`, `LOG_LEVEL`, `SIGNATURE_MAX_DRIFT_SECONDS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `RELAY_TTL_DAYS`.

### Run the mobile app (Mac only)

```sh
pnpm --filter @secretnotebook/mobile expo:prebuild
cd apps/mobile/ios && pod install && cd ../..
pnpm --filter @secretnotebook/mobile ios
# or
pnpm --filter @secretnotebook/mobile android

# Detox E2E:
pnpm --filter @secretnotebook/mobile e2e:build:ios
pnpm --filter @secretnotebook/mobile e2e:ios
```

First boot hits the biometric prompt (Face ID / passcode), generates `device_master`, derives the SQLCipher key, opens the DB. From there: `sqlite3 <path-to-db>` should refuse to open — that's the forensic acceptance for F3.

### Repository conventions

- Tests live in `tests/` (or `e2e/`), never colocated with source.
- Sensitive in-memory state (root key, Safe Word session, lockout counters) **never** goes through Zustand `persist` — cold launch always starts at the locked / unpaired state.
- Cryptography goes through `@secretnotebook/crypto`. New domain-separated keys derive via HKDF with a `secretnotebook/<purpose>/<version>` info string.
- Presentational screens take deps as props; `*Route.tsx` files wire production deps from the Zustand stores.

---

## Phased plan

Each phase is independently shippable and reviewable. The full plan with acceptance criteria per slice is in [`implementation-details.md`](./implementation-details.md); a one-paragraph summary per phase:

- **Phase 1 — MVP.** The Phase-1 happy path described above. F0–F3 build the foundation (monorepo, crypto primitives, API skeleton, SQLCipher mobile shell). S1–S9 are vertical slices: pairing, Safe Word, global posts feed, couple channel, save-for-partner, prompts, random unlock, rating + gratitude + Couple Points, end-to-end Detox.
- **Phase 2 — V2.** Flagging UI + hidden-by-default posts, partner-visible flagged-saves counter, achievements engine with public/private visibility, low-gamification toggle, screenshot blocking, severing with 7-day grace + deterministic wipe.
- **Phase 3 — V3.** `BlockchainAdapter` interface + Noop/Local/EVM-stub adapters with payload-schema allowlist, panic wipe, duress Safe Word, per-screen re-auth, transport-hardening study (Tor / `arti-mobile`).

The cross-phase threat model and the spec-step → phase mapping table both live in `implementation-details.md`.
