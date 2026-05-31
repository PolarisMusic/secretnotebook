/**
 * Persists the FLAG_SECURE patch across every `expo prebuild`.
 *
 * Phase-1 security stance: every connection-content surface gets
 * Android's per-window FLAG_SECURE flag set, which blocks screenshots,
 * hides the window from screen-recording APIs, and substitutes a black
 * thumbnail in the recents view. The simplest implementation is
 * `getWindow().setFlags(FLAG_SECURE, FLAG_SECURE)` on the host
 * Activity's onCreate — covers every screen rendered into it.
 *
 * Before this plugin, the patch lived in apps/mobile/RUNBOOK.md as a
 * post-prebuild manual edit that operators had to re-apply every time
 * `expo prebuild` regenerated MainActivity.kt. That was reliable on
 * the first build and fragile on every subsequent one. This plugin
 * runs as part of prebuild's mod chain and re-applies the edit
 * automatically, so the runbook step goes away and a fresh checkout
 * builds correctly without operator intervention.
 *
 * Idempotency: both injections are guarded by `includes()` checks, so
 * running the plugin against an already-patched file is a no-op. That
 * matters because `withMainActivity` will run on every prebuild
 * regardless of whether the underlying file was regenerated.
 */
const { withMainActivity } = require('@expo/config-plugins');

const IMPORT_LINE = 'import android.view.WindowManager';
const FLAG_BLOCK = `    window.setFlags(
      WindowManager.LayoutParams.FLAG_SECURE,
      WindowManager.LayoutParams.FLAG_SECURE
    )`;

function patchKotlinSource(src) {
  let out = src;

  if (!out.includes(IMPORT_LINE)) {
    // Insert the WindowManager import next to the existing
    // `import android.os.Bundle` so prebuild's import-order tooling
    // doesn't move it around.
    out = out.replace(/import android\.os\.Bundle/, `import android.os.Bundle\n${IMPORT_LINE}`);
  }

  if (!out.includes('FLAG_SECURE')) {
    // Insert the setFlags call immediately after `super.onCreate(null)`
    // so it runs before any React content mounts. Indentation matches
    // the surrounding two-space style Expo emits.
    out = out.replace(/super\.onCreate\(null\)/, `super.onCreate(null)\n${FLAG_BLOCK}`);
  }

  return out;
}

const withAndroidFlagSecure = (config) =>
  withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        'with-android-flag-secure: expected MainActivity.kt, found ' + cfg.modResults.language,
      );
    }
    cfg.modResults.contents = patchKotlinSource(cfg.modResults.contents);
    return cfg;
  });

module.exports = withAndroidFlagSecure;
