import { useMemo } from 'react';
import type * as BlePlx from 'react-native-ble-plx';

import { BleTransport, type PairingTransport } from '@secretnotebook/couple-protocol';

import { useDatabaseStore } from '../../db/store';
import { createBiometricPrompt } from '../../features/pairing/biometric';
import { persistCouple } from '../../features/pairing/persistence';
import { useCoupleStore } from '../../state/couple';
import { PairWithPartner } from './PairWithPartner';

/**
 * Production wiring for PairWithPartner. Constructs a BleTransport (still
 * stubbed — see packages/couple-protocol/src/transport/ble.ts) and a real
 * BiometricPrompt. On successful pairing, persists the couple row,
 * stashes the rootKey on the couple store so the next screen
 * (DefineSafeWord) can consume it, and the navigator advances on the
 * couple.status change.
 *
 * The BLE transport stays stubbed until the peripheral-mode library
 * decision lands (react-native-ble-plx is central-only); this route is
 * the only place the wiring will change.
 */
export function PairWithPartnerRoute(): JSX.Element {
  const biometric = useMemo(() => createBiometricPrompt(), []);
  const exec = useDatabaseStore((s) => s.exec);
  const completePairing = useCoupleStore((s) => s.completePairing);

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
          throw new Error('Database is not ready; cannot persist couple');
        }
        const { coupleId } = await persistCouple(exec, { rootKey, selfPub, peerPub });
        // Snapshots the rootKey into the couple store so DefineSafeWord
        // can derive the Argon2id verifier without re-running pairing.
        completePairing({ coupleId, rootKey });
      }}
    />
  );
}
