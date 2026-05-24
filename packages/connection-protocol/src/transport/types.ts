import type { PairingMessage } from '../pairing/types.js';

export type PairingMessageHandler = (msg: PairingMessage) => void;
export type PairingErrorHandler = (err: Error) => void;
export type Unsubscribe = () => void;

/**
 * Minimal transport surface for the pairing handshake. The state machine
 * never sees BLE specifics — it only knows that messages flow in and out.
 *
 * Lifecycle: `start()` advertises + scans concurrently (or arms whichever
 * direction the platform supports), `send()` delivers a message to the
 * peer once one is reachable, `stop()` tears down all radio resources.
 *
 * Implementations:
 *   - `BleTransport` (apps/mobile)         — react-native-ble-plx based
 *   - `MockTransport` (this package)       — in-process pair for unit tests
 */
export interface PairingTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(msg: PairingMessage): Promise<void>;
  onMessage(handler: PairingMessageHandler): Unsubscribe;
  onError(handler: PairingErrorHandler): Unsubscribe;
}
