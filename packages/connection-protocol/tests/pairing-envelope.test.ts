import { describe, expect, it } from '@jest/globals';

import {
  deserializePairingMessage,
  PAIRING_PROTOCOL_VERSION,
  serializePairingMessage,
} from '../src/pairing/types.js';

describe('pairing message envelope', () => {
  it('round-trips a hello message', () => {
    const ip = new Uint8Array(32).fill(0xa1);
    const ep = new Uint8Array(32).fill(0xa2);
    const wire = serializePairingMessage({ kind: 'hello', identityPub: ip, ephemeralPub: ep });
    const parsed = deserializePairingMessage(wire);
    expect(parsed.kind).toBe('hello');
    expect(Array.from(parsed.identityPub)).toEqual(Array.from(ip));
    expect(Array.from(parsed.ephemeralPub)).toEqual(Array.from(ep));
  });

  it('embeds the protocol version', () => {
    const wire = serializePairingMessage({
      kind: 'hello',
      identityPub: new Uint8Array(32),
      ephemeralPub: new Uint8Array(32),
    });
    expect(JSON.parse(wire).v).toBe(PAIRING_PROTOCOL_VERSION);
  });

  it('rejects a malformed envelope', () => {
    expect(() => deserializePairingMessage('not json')).toThrow();
    expect(() => deserializePairingMessage('null')).toThrow();
    expect(() => deserializePairingMessage(JSON.stringify({ v: 1, kind: 'bogus' }))).toThrow();
    expect(() =>
      deserializePairingMessage(
        JSON.stringify({ v: 99, kind: 'hello', identityPub: '00', ephemeralPub: '00' }),
      ),
    ).toThrow(/version/);
    expect(() =>
      deserializePairingMessage(
        JSON.stringify({ v: 1, kind: 'hello', identityPub: 'zz', ephemeralPub: '00' }),
      ),
    ).toThrow(/hex/);
  });
});
