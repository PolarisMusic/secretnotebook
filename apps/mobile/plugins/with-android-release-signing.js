/**
 * Persists the release-signing config across every `expo prebuild`.
 *
 * The Phase-1.6 deploy walk requires a signed release AAB for the
 * Play Internal Track. Expo prebuild only generates a `debug`
 * signingConfig and wires `buildTypes.release.signingConfig` to it
 * (so `expo run:android --variant release` works locally without a
 * keystore). For the Play upload we need a real `release`
 * signingConfig pointing at the operator's keystore.
 *
 * Before this plugin, that edit lived in apps/mobile/RUNBOOK.md as
 * two post-prebuild manual changes (add the `release { ... }` block,
 * swap the buildTypes.release line) that operators had to re-apply
 * every time prebuild regenerated build.gradle. This plugin injects
 * both edits as part of the mod chain.
 *
 * The keystore path + passwords are read from gradle properties at
 * build time via `findProperty(...)`, falling back to the debug
 * keystore so `expo run:android --variant release` keeps working on a
 * machine that has no release keystore configured. Operators set the
 * real values in `android/gradle.properties` (or via
 * `-PMYAPP_RELEASE_*` on the gradlew CLI) before running
 * `./gradlew bundleRelease`.
 *
 * Idempotency: both edits are guarded so re-running prebuild against
 * an already-patched file is a no-op.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const RELEASE_BLOCK = `
        release {
            storeFile file(findProperty('MYAPP_RELEASE_STORE_FILE') ?: 'debug.keystore')
            storePassword findProperty('MYAPP_RELEASE_STORE_PASSWORD') ?: 'android'
            keyAlias findProperty('MYAPP_RELEASE_KEY_ALIAS') ?: 'androiddebugkey'
            keyPassword findProperty('MYAPP_RELEASE_KEY_PASSWORD') ?: 'android'
        }`;

function patchBuildGradle(src) {
  let out = src;

  // Insert the release { ... } signingConfig next to the existing
  // debug block. The regex matches the debug block specifically so we
  // don't accidentally duplicate-insert if the file structure shifts.
  if (!out.includes("findProperty('MYAPP_RELEASE_STORE_FILE')")) {
    out = out.replace(
      /(signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?\n\s*\})/,
      `$1${RELEASE_BLOCK}`,
    );
  }

  // Swap `buildTypes.release.signingConfig` from debug → release.
  // Prebuild's default wires it at debug so `expo run:android
  // --variant release` works without a keystore; for shipping builds
  // we want the real one.
  out = out.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
    '$1signingConfig signingConfigs.release',
  );

  return out;
}

const withAndroidReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'with-android-release-signing: expected build.gradle (groovy), found ' +
          cfg.modResults.language,
      );
    }
    cfg.modResults.contents = patchBuildGradle(cfg.modResults.contents);
    return cfg;
  });

module.exports = withAndroidReleaseSigning;
