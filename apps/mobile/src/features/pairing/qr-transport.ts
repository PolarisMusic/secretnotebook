import {
  deserializePairingMessage,
  serializePairingMessage,
  type PairingErrorHandler,
  type PairingMessage,
  type PairingMessageHandler,
  type PairingTransport,
  type Unsubscribe,
} from '@secretnotebook/connection-protocol';

/**
 * Same-room pairing transport — both devices display their hello as a QR
 * code and scan the peer's. There is no continuous channel: the transport
 * is a passive bridge between the pairing state machine and the UI.
 *
 * Flow against the existing orchestrator:
 *
 *   1. orchestrator calls `transport.start()`               (no-op)
 *   2. orchestrator calls `transport.send(self hello)`      — we stash the
 *      serialized hello and notify the UI via `onSelfHelloChange`. The UI
 *      renders it as a QR code.
 *   3. The UI opens the camera, scans the peer's QR, and calls
 *      `transport.injectScannedHello(scannedText)`. We parse it and
 *      forward to every onMessage handler — orchestrator sees a
 *      PEER_FOUND and the handshake proceeds.
 *
 * No network, no Bluetooth, no server. Works entirely offline.
 */
export class QrTransport implements PairingTransport {
  private messageHandlers = new Set<PairingMessageHandler>();
  private errorHandlers = new Set<PairingErrorHandler>();
  private selfHello: string | null = null;
  private selfHelloListeners = new Set<(serialized: string) => void>();

  async start(): Promise<void> {
    // Nothing to do — the camera is opened lazily by the screen.
  }

  async stop(): Promise<void> {
    this.selfHello = null;
    this.messageHandlers.clear();
    this.errorHandlers.clear();
    this.selfHelloListeners.clear();
  }

  async send(msg: PairingMessage): Promise<void> {
    const serialized = serializePairingMessage(msg);
    this.selfHello = serialized;
    for (const listener of this.selfHelloListeners) listener(serialized);
  }

  onMessage(handler: PairingMessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onError(handler: PairingErrorHandler): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /** UI-side hook: subscribe to "our hello is ready to render as QR". */
  onSelfHelloChange(listener: (serialized: string) => void): Unsubscribe {
    this.selfHelloListeners.add(listener);
    if (this.selfHello !== null) listener(this.selfHello);
    return () => this.selfHelloListeners.delete(listener);
  }

  /** UI-side hook: the camera scanned a peer QR. */
  injectScannedHello(scannedText: string): void {
    try {
      const msg = deserializePairingMessage(scannedText);
      for (const h of this.messageHandlers) h(msg);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      for (const h of this.errorHandlers) h(e);
    }
  }
}
