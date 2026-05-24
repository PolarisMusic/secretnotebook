import { describe, expect, it } from '@jest/globals';

import { MockTransport, MockTransportBus } from '../src/transport/mock.js';

describe('MockTransport', () => {
  it('delivers a message from sender to peer once both have started', async () => {
    const bus = new MockTransportBus();
    const a = new MockTransport(bus);
    const b = new MockTransport(bus);
    await a.start();
    await b.start();

    const received: Uint8Array[] = [];
    b.onMessage((msg) => received.push(msg.identityPub));
    await a.send({
      kind: 'hello',
      identityPub: new Uint8Array([1, 2, 3]),
      ephemeralPub: new Uint8Array([4, 5, 6]),
    });
    await new Promise((r) => setImmediate(r));

    expect(received).toHaveLength(1);
    expect(Array.from(received[0] as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('queues messages sent before the peer has started, then drains on start', async () => {
    const bus = new MockTransportBus();
    const a = new MockTransport(bus);
    const b = new MockTransport(bus);
    await a.start();

    const received: number[] = [];
    b.onMessage((msg) => received.push(msg.identityPub[0] ?? -1));
    await a.send({
      kind: 'hello',
      identityPub: new Uint8Array([7]),
      ephemeralPub: new Uint8Array([8]),
    });

    expect(received).toEqual([]);
    await b.start();
    await new Promise((r) => setImmediate(r));
    expect(received).toEqual([7]);
  });

  it('does not deliver messages to the sender itself', async () => {
    const bus = new MockTransportBus();
    const a = new MockTransport(bus);
    const b = new MockTransport(bus);
    await a.start();
    await b.start();

    const aReceived: unknown[] = [];
    a.onMessage((m) => aReceived.push(m));
    await a.send({
      kind: 'hello',
      identityPub: new Uint8Array([9]),
      ephemeralPub: new Uint8Array([9]),
    });
    await new Promise((r) => setImmediate(r));
    expect(aReceived).toEqual([]);
  });

  it('rejects sends before start', async () => {
    const bus = new MockTransportBus();
    const a = new MockTransport(bus);
    await expect(
      a.send({
        kind: 'hello',
        identityPub: new Uint8Array(32),
        ephemeralPub: new Uint8Array(32),
      }),
    ).rejects.toThrow(/start/);
  });

  it('surfaces a parse error to onError handlers when a wire blob is malformed', async () => {
    const bus = new MockTransportBus();
    const a = new MockTransport(bus);
    await a.start();
    const errors: Error[] = [];
    a.onError((e) => errors.push(e));
    a._receive('not-json');
    expect(errors).toHaveLength(1);
  });
});
