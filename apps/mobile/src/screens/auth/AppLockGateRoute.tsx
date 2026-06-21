import { useEffect, useMemo, useState } from 'react';

import { createBiometricPrompt } from '../../features/pairing/biometric';
import { useAppLockSession } from '../../features/app-lock/session';
import { AppLockGate } from './AppLockGate';

// Metro inlines `process.env.EXPO_PUBLIC_*` at bundle time; declare the
// narrow shape we read so we don't depend on @types/node here.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> } | undefined;
const APP_LOCK_DISABLED =
  typeof process !== 'undefined' && process?.env
    ? process.env.EXPO_PUBLIC_DISABLE_APP_LOCK === '1'
    : false;

/**
 * Production wiring for the biometric app-lock. Prompts Face ID / Touch ID
 * (with device-passcode fallback). Dev/simulator safety: if the device has
 * no biometric capability at all, or the lock is explicitly disabled via
 * EXPO_PUBLIC_DISABLE_APP_LOCK=1, we unlock automatically so testers are
 * never stranded.
 */
export function AppLockGateRoute(): JSX.Element {
  const biometric = useMemo(() => createBiometricPrompt(), []);
  const unlock = useAppLockSession((s) => s.unlock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attempt(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (APP_LOCK_DISABLED) {
        unlock();
        return;
      }
      const available = await biometric.isAvailable();
      if (!available) {
        // No Face ID / Touch ID / passcode capability (e.g. simulator) —
        // don't lock the user out of their own notes.
        unlock();
        return;
      }
      const res = await biometric.authenticate('Unlock to open your notes');
      if (res.ok) {
        unlock();
      } else {
        setError('Unlock cancelled. Tap Unlock to try again.');
      }
    } catch (e) {
      setError((e as Error).message ?? 'Could not unlock. Tap to try again.');
    } finally {
      setBusy(false);
    }
  }

  // Auto-prompt exactly once per lock-session. The guard is the session
  // store's `autoPrompted` flag (not component state), so a remount of this
  // gate — e.g. when RootStack re-renders as an upstream store hydrates —
  // doesn't fire a second Face ID prompt. lock() and the cold-start default
  // reset the flag, so the next locked session prompts again. The manual
  // Unlock button stays available for retries.
  useEffect(() => {
    const session = useAppLockSession.getState();
    if (session.autoPrompted) return;
    session.markAutoPrompted();
    void attempt();
    // Mount-only on purpose: the one-shot guard lives in the session store,
    // not in this dependency array.
  }, []);

  return <AppLockGate onUnlock={() => void attempt()} busy={busy} error={error} />;
}
