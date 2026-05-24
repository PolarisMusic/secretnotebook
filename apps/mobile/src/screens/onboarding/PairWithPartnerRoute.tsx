import { useMemo } from 'react';
import type * as BlePlx from 'react-native-ble-plx';

import { BleTransport, type PairingTransport } from '@secretnotebook/connection-protocol';

import { useDatabaseStore } from '../../db/store';
import { createBiometricPrompt } from '../../features/pairing/biometric';
import { persistConnection } from '../../features/pairing/persistence';
import { useConnectionStore } from '../../state/connection';
import { PairWithPartner } from './PairWithPartner';

/**
 * Production wiring for PairWithPartner. Constructs a BleTransport (still
 * stubbed — see packages/connection-protocol/src/transport/ble.ts) and a real
 * BiometricPrompt. On successful pairing, persists the connection row,
 * stashes the rootKey on the connection store so the next screen
 * (DefineSafeWord) can consume it, and the navigator advances on the
 * connection.status change.
 *
 * The BLE transport stays stubbed until the peripheral-mode library
 * decision lands (react-native-ble-plx is central-only); this route is
 * the only place the wiring will change.
 */
export function PairWithPartnerRoute(): JSX.Element {
  const biometric = useMemo(() => createBiometricPrompt(), []);
  const exec = useDatabaseStore((s) => s.exec);
  const completePairing = useConnectionStore((s) => s.completePairing);

  const transportFactory = (): PairingTransport => {
    // Lazy require — only the native build needs this module; Node tsc
    // typechecks the imported `BlePlx` types without ever resolving the
    // value at compile time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const blePlx = require('react-native-ble-plx') as typeof BlePlx;
    return new BleTransport({ manager: new blePlx.BleManager() });
  };

  return (
    <PairWithPartner
      biometric={biometric}
      transportFactory={transportFactory}
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
