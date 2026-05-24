import type { PairingMessage } from '../pairing/types.js';
import { deserializePairingMessage, serializePairingMessage } from '../pairing/types.js';
import type {
  PairingErrorHandler,
  PairingMessageHandler,
  PairingTransport,
  Unsubscribe,
} from './types.js';

/**
 * Shared in-process bus for paired MockTransport instances. Two transports
 * created from the same bus see each other's messages; messages are queued
 * if the recipient hasn't started yet so test ordering doesn't matter.
 */
export class MockTransportBus {
  private endpoints: MockTransport[] = [];

  register(endpoint: MockTransport): void {
    this.endpoints.push(endpoint);
  }

  unregister(endpoint: MockTransport): void {
    this.endpoints = this.endpoints.filter((e) => e !== endpoint);
  }

  /** Deliver `wire` to every endpoint except the sender. */
  fanout(sender: MockTransport, wire: string): void {
    for (const e of this.endpoints) {
      if (e !== sender) e._receive(wire);
    }
  }
}

export class MockTransport implements PairingTransport {
  private started = false;
  private messageHandlers = new Set<PairingMessageHandler>();
  private errorHandlers = new Set<PairingErrorHandler>();
  private pending: string[] = [];

  constructor(private readonly bus: MockTransportBus) {
    bus.register(this);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const drained = this.pending;
    this.pending = [];
    for (const wire of drained) this.dispatch(wire);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.bus.unregister(this);
    this.messageHandlers.clear();
    this.errorHandlers.clear();
  }

  async send(msg: PairingMessage): Promise<void> {
    if (!this.started) throw new Error('MockTransport.send before start');
    this.bus.fanout(this, serializePairingMessage(msg));
  }

  onMessage(handler: PairingMessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onError(handler: PairingErrorHandler): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /** Internal: invoked by the bus when a peer sends. */
  _receive(wire: string): void {
    if (!this.started) {
      this.pending.push(wire);
      return;
    }
    this.dispatch(wire);
  }

  private dispatch(wire: string): void {
    let msg: PairingMessage;
    try {
      msg = deserializePairingMessage(wire);
    } catch (e) {
      for (const h of this.errorHandlers) h(e as Error);
      return;
    }
    for (const h of this.messageHandlers) h(msg);
  }
}
