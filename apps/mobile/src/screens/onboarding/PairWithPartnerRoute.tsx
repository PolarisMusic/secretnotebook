import { useMemo } from 'react';
import type * as BlePlx from 'react-native-ble-plx';

import { BleTransport, type PairingTransport } from '@secretnotebook/couple-protocol';

import { createBiometricPrompt } from '../../features/pairing/biometric';
import { PairWithPartner } from './PairWithPartner';

/**
 * Production wiring for PairWithPartner. Constructs a BleTransport (still
 * stubbed — see packages/couple-protocol/src/transport/ble.ts) and a real
 * BiometricPrompt. Persistence of the resulting couple row is handled by
 * the onPaired hook, which the App-level navigator passes down once the
 * DB handle is available.
 *
 * For Push B the BLE transport throws on start; the screen will surface
 * that as an error and offer Try again. Once the real BLE peripheral side
 * is implemented (separate library — react-native-ble-plx is central-only),
 * this route component is the only place the wiring changes.
 */
export function PairWithPartnerRoute(): JSX.Element {
  const biometric = useMemo(() => createBiometricPrompt(), []);

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
      onPaired={async () => {
        // The DB handle is plumbed in at the App level in a follow-up;
        // for now the screen advances the couple store via its own
        // setCoupleStatus call and S2 owns Safe Word persistence.
      }}
    />
  );
}
