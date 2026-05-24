import { useEffect } from 'react';
import { NativeModules, Platform } from 'react-native';

import { applySecureScreen } from './secure-screen-policy';

interface SecretSecureScreenModule {
  setFlagSecure(enabled: boolean): void;
}

export {
  applySecureScreen,
  type SecureScreenOptions,
  type SecureScreenOutcome,
} from './secure-screen-policy';

/**
 * Hook that pins Android FLAG_SECURE on for the lifetime of the
 * mounting component. Call once from the root of any phase that
 * displays couple-content (RootStack covers Main + Gate; Onboarding
 * also shows the Safe Word during definition so it's worth keeping on
 * app-wide).
 *
 * The native bridge `SecretSecureScreen` is registered by the
 * prebuild patch documented in apps/mobile/RUNBOOK.md §FLAG_SECURE.
 * When the module isn't present (e.g. dev / Expo Go / iOS / Jest) the
 * call is a transparent no-op.
 */
export function useSecureScreen(enabled = true): void {
  useEffect(() => {
    const mod = (NativeModules as { SecretSecureScreen?: SecretSecureScreenModule })
      .SecretSecureScreen;
    const bridge = mod ? (v: boolean) => mod.setFlagSecure(v) : null;
    applySecureScreen(enabled, { platform: Platform.OS, setFlagSecure: bridge });
    return () => {
      if (enabled) {
        applySecureScreen(false, { platform: Platform.OS, setFlagSecure: bridge });
      }
    };
  }, [enabled]);
}
