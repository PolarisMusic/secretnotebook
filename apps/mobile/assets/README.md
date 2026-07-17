# App assets

## `icon.png` — the app icon (and splash logo)

Referenced by `app.json` (`expo.icon`, `expo.splash.image`, and
`expo.android.adaptiveIcon.foregroundImage`). Expo generates every platform
size from this one file during `expo prebuild`.

**The committed `icon.png` is a placeholder** (a dark square with a light
circle). Replace it with the real logo — keep the same name and path
(`apps/mobile/assets/icon.png`).

Requirements for the replacement:

- **1024 × 1024 pixels**, square.
- **PNG**, **no transparency** (a flat background). The App Store rejects an
  icon that has an alpha channel, so it must be fully opaque.
- The artwork should sit comfortably inside the square — for the Android
  adaptive icon the outer ~15% can be cropped by the system mask, so avoid
  putting anything important at the very edges.

After replacing it, the next `expo prebuild` + build picks it up automatically.
