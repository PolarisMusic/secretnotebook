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
 * Long-distance pairing transport — partners share a short rendezvous
 * code out-of-band (text, Signal, voice) and rendezvous via the API
 * server (see apps/api/src/routes/pair-rendezvous.ts).
 *
 *   1. orchestrator calls `transport.start()` — opens a polling loop
 *      against GET /v1/pair/:code.
 *   2. orchestrator calls `transport.send(self hello)` — POSTs the
 *      serialized hello to /v1/pair/:code.
 *   3. The polling loop notices a second hello posted under the same
 *      code (the one whose bytes don't match our own) and emits it via
 *      every onMessage handler. The orchestrator dispatches PEER_FOUND
 *      and the handshake proceeds.
 *
 * The server stores at most two hellos per code and TTLs them at ~10 min;
 * cross-internet pairing is expected to complete well within that window.
 * The server never sees private keys, biometric confirmation, or the
 * derived root key.
 */

export interface RelayTransportOptions {
  /** Rendezvous code; must satisfy the API route regex `[a-z0-9-]{6,16}`. */
  readonly code: string;
  /** Base URL of the API (no trailing slash). */
  readonly baseUrl: string;
  /** Polling interval (ms). Default 2000. */
  readonly pollIntervalMs?: number;
  /** Total timeout for the pairing attempt (ms). Default 5 minutes. */
  readonly timeoutMs?: number;
  /** Injected fetch — defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

interface PairGetResponse {
  hellos: Array<{ hello: string; postedAt: string }>;
}

export class RelayTransport implements PairingTransport {
  private readonly code: string;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  private messageHandlers = new Set<PairingMessageHandler>();
  private errorHandlers = new Set<PairingErrorHandler>();

  private selfSerialized: string | null = null;
  private peerDelivered = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private stopped = false;

  constructor(opts: RelayTransportOptions) {
    this.code = opts.code.trim().toLowerCase();
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async start(): Promise<void> {
    this.deadline = Date.now() + this.timeoutMs;
    this.schedulePoll(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.messageHandlers.clear();
    this.errorHandlers.clear();
  }

  async send(msg: PairingMessage): Promise<void> {
    this.selfSerialized = serializePairingMessage(msg);
    const res = await this.fetchImpl(`${this.baseUrl}/v1/pair/${this.code}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: this.selfSerialized }),
    });
    if (!res.ok) {
      throw new Error(`pair rendezvous POST failed: ${res.status}`);
    }
  }

  onMessage(handler: PairingMessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onError(handler: PairingErrorHandler): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      void this.pollOnce();
    }, delayMs);
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || this.peerDelivered) return;
    if (Date.now() > this.deadline) {
      this.emitError(new Error('pairing timed out — ask your partner to retry the same code'));
      return;
    }
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/pair/${this.code}`, {
        method: 'GET',
      });
      if (res.ok) {
        const body = (await res.json()) as PairGetResponse;
        const peer = body.hellos.find((h) => h.hello !== this.selfSerialized);
        if (peer) {
          this.peerDelivered = true;
          try {
            const msg = deserializePairingMessage(peer.hello);
            for (const h of this.messageHandlers) h(msg);
          } catch (parseErr) {
            this.emitError(parseErr instanceof Error ? parseErr : new Error(String(parseErr)));
          }
          return;
        }
      }
    } catch (err) {
      // Network blips are expected on mobile; keep polling until the
      // deadline rather than failing the whole pairing on a single
      // transient error.
      void err;
    }
    this.schedulePoll(this.pollIntervalMs);
  }

  private emitError(e: Error): void {
    for (const h of this.errorHandlers) h(e);
  }
}
