import type { PairingMessage } from '../pairing/types.js';
import type {
  PairingErrorHandler,
  PairingMessageHandler,
  PairingTransport,
  Unsubscribe,
} from './types.js';

/**
 * Stable identifiers for the pairing GATT service. Both devices know these
 * at compile time; no external coordination is needed.
 *   Service: a random v4 UUID, lowercased.
 *   Characteristic: another random v4 UUID — writable from the central
 *   side and notifying from the peripheral side.
 *
 * BLE peripheral mode is iOS-restricted: when the app is backgrounded the
 * advertise may pause. Pairing UI is therefore foreground-only — the user
 * is expected to keep both apps open during the 6-digit code step.
 */
export const PAIRING_SERVICE_UUID = '2bba6c4f-2c5f-4b3e-9a07-2c0e4b8c9c47';
export const PAIRING_HELLO_CHARACTERISTIC_UUID = '2bba6c4f-2c60-4b3e-9a07-2c0e4b8c9c47';

export interface BleDependencies {
  /** Injected at construction time so this file does not import
   *  `react-native-ble-plx` directly (keeps the package Node-typecheckable
   *  and unit-testable in isolation). */
  readonly manager: BleManagerLike;
}

/**
 * The subset of react-native-ble-plx's `BleManager` we actually depend on.
 * Captured as an interface so we never form a hard runtime dependency on
 * the native module from a workspace package.
 */
export interface BleManagerLike {
  startDeviceScan(
    serviceUUIDs: string[] | null,
    options: unknown,
    listener: (error: Error | null, device: BleDeviceLike | null) => void,
  ): void;
  stopDeviceScan(): void;
}

export interface BleDeviceLike {
  readonly id: string;
  connect(): Promise<BleDeviceLike>;
  discoverAllServicesAndCharacteristics(): Promise<BleDeviceLike>;
  writeCharacteristicWithResponseForService(
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string,
  ): Promise<BleDeviceLike>;
  monitorCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: Error | null, characteristic: { value: string | null } | null) => void,
  ): { remove(): void };
  cancelConnection(): Promise<BleDeviceLike>;
}

/**
 * Skeleton BLE pairing transport. The full advertise/scan + GATT
 * read/write/notify wiring lands in S1 Push B alongside the screen.
 * For now this is enough surface for the state machine to compile against
 * a real transport and for callers in apps/mobile to depend on a stable
 * import path.
 */
export class BleTransport implements PairingTransport {
  constructor(_deps: BleDependencies) {
    // Stored at the field level in S1 Push B once the implementation lands.
    void _deps;
  }

  async start(): Promise<void> {
    throw new Error('BleTransport.start: implemented in S1 Push B');
  }

  async stop(): Promise<void> {
    /* no-op until S1 Push B */
  }

  async send(_msg: PairingMessage): Promise<void> {
    throw new Error('BleTransport.send: implemented in S1 Push B');
  }

  onMessage(_handler: PairingMessageHandler): Unsubscribe {
    return () => undefined;
  }

  onError(_handler: PairingErrorHandler): Unsubscribe {
    return () => undefined;
  }
}
