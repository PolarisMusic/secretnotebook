import { useMemo, useState } from 'react';

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

  return <AppLockGate onUnlock={() => void attempt()} busy={busy} error={error} />;
}
