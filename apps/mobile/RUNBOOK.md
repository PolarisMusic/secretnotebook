# Secret Notebook — Mobile Runbook

Operator-facing reference for everything the CI gate can't run on its
own: the two-device Detox walk, the security smoke verifications
(SQLCipher CLI proof, Android `FLAG_SECURE`, biometric-after-background),
and the internal-distribution paths (TestFlight + Android Internal Track).

All commands below assume a macOS host with Xcode + Android Studio
installed; the CI box can't drive simulators or build signed bundles, so
this is the file you reach for the day of a verification pass.

> **Phase-1.5 reshape (R0–R5).** The Phase-1 role-play / prompt /
> save-for-partner / unlocked-saved loop has been retired. The current
> couple-channel surface is: shared + secret **notes** (R2), per-note
> **publish** to the global feed (R3), per-partner **role** on the
> connection (R4), and **IAP-gated publish** (R5). The "+37 Couple
> Points" verification target is gone; the new end-to-end target
> reads from `screen.notes` / `screen.notes-detail` and
> `connection-home.role.partner_{a,b}`. The walk in §3 below has been
> rewritten accordingly. Protocol-level coverage of the new surface
> (notes round-trip, secret-body-never-on-wire invariant, publish
> propagation, IAP gate fail-closed) lives in
> `apps/mobile/tests/full-loop.test.ts` and runs in CI.

---

## 0. Prerequisites

- macOS 14+ with Xcode 15+ and Command Line Tools (`xcode-select --install`)
- Android Studio with at least one AVD installed (Pixel 6 / API 34 used below)
- Node 20+, pnpm 9+
- Detox 20 CLI: `pnpm dlx detox-cli` (or rely on the workspace binary)
- `applesimutils` for iOS: `brew tap wix/brew && brew install applesimutils`

From a fresh clone:

```bash
pnpm install
pnpm --filter @secretnotebook/mobile expo:prebuild
```

`expo prebuild` generates `apps/mobile/ios/` and `apps/mobile/android/`.
Both directories are git-ignored — every operator regenerates them on
their own machine and applies the patches below before building.

---

## 1. Native patches applied after `expo prebuild`

The Expo bare workflow regenerates the native projects on every prebuild,
so any native-code edits must be re-applied after each `pnpm expo:prebuild`.
Phase-1 needs two patches.

### 1.1 `FLAG_SECURE` on Android

`FLAG_SECURE` is a per-window flag that blocks screenshots, hides the
window from screen-recording APIs, and substitutes a black thumbnail in
the recents view. Phase-1's security stance is: every connection-content
surface gets it. The simplest implementation is to set the flag on the
host `Activity` itself, which covers every screen rendered into it.

Edit `apps/mobile/android/app/src/main/java/com/secretnotebook/app/MainActivity.java`
and add `WindowManager.LayoutParams.FLAG_SECURE` to `onCreate`:

```java
import android.os.Bundle;
import android.view.WindowManager;

@Override
protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().setFlags(
        WindowManager.LayoutParams.FLAG_SECURE,
        WindowManager.LayoutParams.FLAG_SECURE
    );
}
```

That's the whole patch. The JS-side `useSecureScreen()` hook in
`src/security/secure-screen.ts` is a forward-looking stub for per-screen
control — until the matching `SecretSecureScreen` native module is
registered it cleanly no-ops, which keeps dev / Expo Go / Jest unaffected.

**Verify it took:**

1. Build + install: `pnpm --filter @secretnotebook/mobile android`
2. With the app foregrounded, press the home button → open the recents view
3. The Secret Notebook thumbnail should appear as a solid black tile
4. From `adb`: `adb shell screencap -p /sdcard/secretnotebook.png && adb pull /sdcard/secretnotebook.png .` — the file should exist but contain only a black image / fail to capture the app surface

### 1.2 iOS — no patch needed in Phase 1

iOS doesn't expose `FLAG_SECURE`. The OS handles recents-thumbnail
blurring automatically for apps without an explicit opt-out, and we
don't opt out, so this is a no-op. (Phase 2 will add `UIView` snapshot
interception for full screen-recording prevention on iOS.)

---

## 2. Security smoke verifications

### 2.1 SQLCipher at rest — sqlite3 CLI cannot open the DB

Foundation acceptance from the implementation plan: the on-device DB
file must be opaque to a plain `sqlite3` binary.

**iOS Simulator path:**

```bash
# Find the running sim's data container
xcrun simctl get_app_container booted com.secretnotebook.app data
# Inside that path the DB sits at Library/<wherever-op-sqlite-puts-it>
# (search with `find <container> -name '*.db' -o -name '*.sqlite*'`)

sqlite3 <path>/secretnotebook.db .tables
# Expected: "Error: file is not a database" — SQLCipher pages are
# unreadable without the key.
```

**Android Emulator path:**

```bash
adb shell run-as com.secretnotebook.app find /data/data/com.secretnotebook.app -name '*.db'
adb shell run-as com.secretnotebook.app cat /data/data/com.secretnotebook.app/<path>/secretnotebook.db > /tmp/leaked.db
sqlite3 /tmp/leaked.db .tables
# Same expected output: "file is not a database".
```

If either path succeeds in reading tables, SQLCipher is mis-keyed — file
a P0 bug.

### 2.2 Biometric required after backgrounding

Phase-1 stance: cold launch + background-longer-than-60-seconds both
force the Safe Word gate; the gate's `gate.submit` is the entry point
back into Main. The biometric prompt fires implicitly as a side-effect
of the keychain read during cold-launch bootstrap (see
`src/features/boot/bootstrap.ts`).

**Verify:**

1. Pair + Safe Word both partners
2. Background the app for 70 seconds (`xcrun simctl push` a clock-skip helper, or just wait)
3. Foreground the app
4. Expected: `screen.safeword_gate` is visible. Typing the correct word + `gate.submit` lands on `screen.global-feed`
5. Force-quit + re-open the app
6. Expected: the OS biometric prompt fires immediately (the bootstrap reads the keychain), then the Safe Word gate appears

If step 6 doesn't trigger biometric, either the keychain entry was created without `accessControl: 'biometryAny'` (check `src/security/device-master.ts`) or the simulator/emulator doesn't have biometric enrolled (iOS: Hardware → Face ID → Enrolled; Android: AVD has fingerprint).

### 2.3 Sentry PII scrubber — covered by unit test

`pnpm --filter @secretnotebook/mobile test -- --testPathPattern sentry-scrubber`
runs 10 cases covering every PII surface (Sentry `extra`, breadcrumbs,
stack-trace local-variable dumps, `user.email`, free-text pubkey
literals, UUIDs). This runs in CI; no operator action.

---

## 3. Two-device Detox walk (Phase-1.5)

The Phase-1.5 happy path lives in `apps/mobile/e2e/happy-path.test.ts`.
Single-sim-reachable steps (Welcome → Pair-start) run as live `it()`
blocks in the CI Detox config; the two-device steps ship as `it.todo()`
with the exact tap script inline.

Until a partner-side scripting bridge lands, the two-device steps are
executed manually: launch two simulators side-by-side, walk the tap
script step by step, asserting after each tap that the listed testID
becomes visible.

### 3.1 Run the single-sim CI portion

```bash
pnpm --filter @secretnotebook/mobile e2e:build:ios
pnpm --filter @secretnotebook/mobile e2e:ios

# Android equivalent (AVD must already be running):
pnpm --filter @secretnotebook/mobile e2e:build:android
pnpm --filter @secretnotebook/mobile e2e:android
```

The smoke + the live `it()` blocks from `happy-path.test.ts` should both
pass; the `it.todo()` placeholders are reported as todos, not failures.

### 3.2 Run the two-device portion (manual)

> **IAP gate during testing.** Set
> `EXPO_PUBLIC_DEV_GRANT_ENTITLEMENT=1` in the build env to short-
> circuit the R5 publish paywall for tester builds. Without it, the
> S6 publish steps surface `paywall.subscribe` because no real
> sandbox IAP is wired yet (production validator is a deliberate
> throw — see `apps/mobile/src/features/iap/dev-grant.ts`). Flip
> the flag back to `0` for any external-tester or production
> distribution.

1. Boot two iOS sims with different names:
   ```bash
   xcrun simctl boot "iPhone 15"
   xcrun simctl boot "iPhone 15 Pro"  # second sim, different device type
   open -a Simulator
   ```
2. Install the debug build on both:
   ```bash
   xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/SecretNotebook.app
   ```
   Repeat targeting the second sim by UDID (`xcrun simctl install <udid> <path>`).
3. Open `happy-path.test.ts` next to your simulators and walk each `it.todo()` step in order. Each todo is annotated with `A:` / `B:` to indicate which sim performs the tap.
4. For every step, assert the listed testID is visible (use the Detox inspector via `xcrun simctl spawn booted log stream` if a tap doesn't land).

### 3.3 Expected end state (Phase-1.5 acceptance)

After the §3.2 walk completes:

- **Notes (R2):** both sims show the same `notes.list` content. Shared
  notes have their body visible on both sides; secret notes that were
  written-and-revealed have body visible on both sides; secret notes
  still in pre-reveal show `notes.body.locked` on the partner side.
- **Roles (R4):** `connection-home.role.partner_a` and
  `connection-home.role.partner_b` read the same values on both sims
  (whatever the script set — typically `masculine` / `feminine`).
- **Publish (R3 + R5):** for every note that was published, both sims
  show `notes-detail.published-badge` with the matching
  `global_post_id`, and `feed.post.<global_post_id>` is at the top of
  the global feed on both sides as well as visible to any third
  device on the same feed.
- **IAP gate (R5):** publish attempts without a current entitlement
  surface `paywall.subscribe` (fresh) or `paywall.renew` (expired);
  the local note row's `published_at` does NOT change in the
  blocked case.

The protocol-level invariants (notes round-trip, secret-body-never-
on-wire, publish propagation, hostile-replay no-op, IAP gate fail-
closed at the border) are covered mechanically by the in-process
two-device harness `apps/mobile/tests/full-loop.test.ts`. That suite
runs in CI on every push and is the authority for whether the
sync-layer contracts hold — the Detox walk is the UI verification
layer on top.

---

## 4. Deploy the API for testers

The mobile app's default API base URL points at `http://localhost:3000`
which works only for the simulator running on the host that's already
running `docker-compose up`. To put a TestFlight / Internal Track build
in front of testers, the moderation API has to live on a public host.

### 4.1 Pick a PaaS

Either of these works with the existing `infra/docker/api.Dockerfile`:

- **Fly.io** (recommended for solo / small-scale): ~$5/mo for the
  service + a Postgres-managed Fly cluster, single `fly.toml`. Includes
  TLS termination + HTTP/2 + a public hostname.
- **Railway**: one-click Postgres + Docker service, deploys on push
  from GitHub. Slightly higher floor but zero-config.

Either path uses the same image + same env vars below.

### 4.2 Fly.io path

From the repo root:

```bash
fly launch --dockerfile infra/docker/api.Dockerfile --no-deploy
# Accept defaults; pick a region close to your testers; create a
# Postgres-managed cluster when prompted. Fly will write fly.toml.

fly secrets set \
  DATABASE_URL=postgres://...      # from `fly postgres connect`
  RATE_LIMIT_MAX=200 \
  RELAY_TTL_DAYS=30 \
  SIGNATURE_MAX_DRIFT_SECONDS=300

fly deploy
fly status   # captures the public URL, e.g. https://<app>.fly.dev
```

The Dockerfile applies pending SQL migrations on every container
start before launching the server, so the first deploy initialises
the schema on the fresh Postgres without an extra step.

### 4.3 Railway path

1. New project → Deploy from GitHub repo → pick `polarismusic/secretnotebook`
2. Service → Settings → Build → Dockerfile path: `infra/docker/api.Dockerfile`
3. Add Postgres plugin → Railway sets `DATABASE_URL` automatically
4. Service → Variables → set `RATE_LIMIT_MAX=200`,
   `RELAY_TTL_DAYS=30`, `SIGNATURE_MAX_DRIFT_SECONDS=300`
5. Deploy. The public domain shows up under Service → Settings → Networking

### 4.4 Verify the deploy

```bash
curl https://<your-host>/v1/health
# {"ok":true,...}
```

If the health check fails, `fly logs` / Railway's log tail will show
the migration step's output — the runner logs `applied <filename>` /
`skip <filename>` per migration, then the server boots.

### 4.5 Point the mobile build at the deployed host

Set the env var before the next `expo prebuild` / `eas build`:

```bash
export EXPO_PUBLIC_API_BASE_URL=https://<your-host>
```

This value is inlined into the JS bundle by Metro at build time; a
build kicked without it will fall back to `http://localhost:3000`
which won't reach anything on a real phone.

For internal-tester builds, also set the dev IAP grant:

```bash
export EXPO_PUBLIC_DEV_GRANT_ENTITLEMENT=1
```

`0` (or unset) leaves the publish gate fail-closed — appropriate for
external testers and prod. See `apps/mobile/.env.example` for the
authoritative list.

---

## 5. Internal distribution

### 5.1 iOS — TestFlight

1. Bump `version` in `apps/mobile/app.json`
2. `pnpm --filter @secretnotebook/mobile expo:prebuild` (re-apply native patches from §1)
3. Open `apps/mobile/ios/SecretNotebook.xcworkspace` in Xcode
4. Select **Any iOS Device (arm64)** as the run target
5. Product → Archive
6. Once the archive completes, in Organizer: Distribute App → App Store Connect → Upload
7. After processing (~10 min), the build is available in App Store Connect → Builds. Add to the existing TestFlight internal-testing group
8. Internal testers get a push from the TestFlight app within the hour

**Note**: the `ITSAppUsesNonExemptEncryption` key is already set to
`false` in `app.json` — we use no cryptography beyond what's exempt
(libsodium for E2EE between users, not a regulated export item).

### 5.2 Android — Internal Track

1. Bump `versionCode` and `versionName` in `apps/mobile/android/app/build.gradle` (regenerated by prebuild; keep the bumps in sync via `app.json`)
2. `pnpm --filter @secretnotebook/mobile expo:prebuild` (re-apply native patches from §1)
3. Generate a signed release bundle:
   ```bash
   cd apps/mobile/android
   ./gradlew bundleRelease
   ```
   The bundle lands at `app/build/outputs/bundle/release/app-release.aab`.
4. Upload via Play Console → Internal Testing → Create new release → Upload
5. After Play scanning completes (~30 min), the testers in the linked Google Group get an opt-in link

---

## 6. Troubleshooting

### "Cannot find module @secretnotebook/..."

After any package change, run `pnpm install` from the repo root and
`pnpm -w build` to refresh the dist outputs.

### Detox build fails on iOS with "No such module 'EXKeychain'"

Run `cd apps/mobile/ios && pod install` after every `expo prebuild`.

### `useSecureScreen` doesn't seem to be blocking screenshots

The hook is a no-op until the native bridge is registered (see §1.1).
For Phase-1 the `MainActivity.onCreate` patch is what actually sets the
flag — the hook is forward-looking infra. Verify via the recents-view
check in §1.1, not by introspecting JS.

### "EADDRINUSE" on `expo start`

Another Expo dev server is already running (`lsof -i :8081`); kill it or
`expo start --port 8082`.

### Two sims clash on BLE — only one finds the other

The simulators share the host's BLE adapter. Use the BLE mock harness
(`__BLE_MOCK_ENABLED__=true`) for Detox runs, and only fall back to real
BLE on physical devices for the final sign-off pass.
