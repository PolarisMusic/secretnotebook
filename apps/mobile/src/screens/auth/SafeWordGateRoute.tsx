import { useDatabaseStore } from '../../db/store';
import {
  isLockedOut,
  lockoutRemainingMs,
  useSafeWordLockout,
} from '../../features/safeword/lockout';
import { useSafeWordSession } from '../../features/safeword/session';
import { verifyConnectionSafeWord } from '../../features/safeword/verifier';
import { useConnectionStore } from '../../state/connection';
import { SafeWordGate } from './SafeWordGate';

/**
 * Production wiring for the Safe Word gate. Verifies against the active
 * connection row, drives the in-memory lockout store on each wrong attempt,
 * and satisfies the Safe Word session on success.
 */
export function SafeWordGateRoute(): JSX.Element {
  const exec = useDatabaseStore((s) => s.exec);
  const connectionId = useConnectionStore((s) => s.connectionId);
  const satisfySession = useSafeWordSession((s) => s.satisfy);

  return (
    <SafeWordGate
      lockoutRemainingMs={() => lockoutRemainingMs()}
      verify={async (candidate) => {
        if (!exec || !connectionId) return false;
        if (isLockedOut()) return false;
        const ok = await verifyConnectionSafeWord(exec, connectionId, candidate);
        if (ok) {
          useSafeWordLockout.getState().recordSuccess();
        } else {
          useSafeWordLockout.getState().recordFailure();
        }
        return ok;
      }}
      onUnlocked={() => satisfySession()}
    />
  );
}
