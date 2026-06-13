import { useMemo } from 'react';

import { useDatabaseStore } from '../../db/store';
import { DEFAULT_API_CONFIG } from '../../features/api/config';
import { createBiometricPrompt } from '../../features/pairing/biometric';
import { persistConnection } from '../../features/pairing/persistence';
import { useConnectionStore } from '../../state/connection';
import { PairWithPartner } from './PairWithPartner';

/**
 * Production wiring for PairWithPartner. Constructs a real BiometricPrompt
 * and forwards the deployed API base URL so the relay transport can
 * rendezvous through it. On successful pairing, persists the connection
 * row, stashes the rootKey on the connection store so DefineSafeWord can
 * consume it, and the navigator advances on the connection.status change.
 *
 * The screen itself decides whether to instantiate a QrTransport
 * (same-room, no network) or a RelayTransport (long-distance, hits the
 * API) based on the mode the user picks.
 */
export function PairWithPartnerRoute(): JSX.Element {
  const biometric = useMemo(() => createBiometricPrompt(), []);
  const exec = useDatabaseStore((s) => s.exec);
  const completePairing = useConnectionStore((s) => s.completePairing);

  return (
    <PairWithPartner
      apiBaseUrl={DEFAULT_API_CONFIG.baseUrl}
      biometric={biometric}
      onPaired={async ({ rootKey, selfPub, peerPub }) => {
        if (!exec) {
          throw new Error('Database is not ready; cannot persist connection');
        }
        const { connectionId } = await persistConnection(exec, { rootKey, selfPub, peerPub });
        // Snapshots the rootKey into the connection store so DefineSafeWord
        // can derive the Argon2id verifier without re-running pairing.
        completePairing({ connectionId, rootKey });
      }}
    />
  );
}
