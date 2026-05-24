/**
 * Wire-level pairing messages. Only one message type is needed for the
 * pairing handshake itself — a hello carrying both keys the peer needs to
 * derive the shared root_key. Safe-Word verifier exchange (S2) reuses the
 * post-handshake connection channel rather than the pairing transport.
 */
export interface PairingHello {
  readonly kind: 'hello';
  readonly identityPub: Uint8Array;
  readonly ephemeralPub: Uint8Array;
}

export type PairingMessage = PairingHello;

export const PAIRING_PROTOCOL_VERSION = 1;

/**
 * Compact JSON envelope for transports that move text or bytes-of-text
 * (BLE characteristic writes do this). Pubkeys are hex so the wire format
 * stays human-readable in debug logs without leaking anything private.
 */
interface SerializedHello {
  readonly v: number;
  readonly kind: 'hello';
  readonly identityPub: string;
  readonly ephemeralPub: string;
}

export function serializePairingMessage(msg: PairingMessage): string {
  return JSON.stringify(serialized(msg));
}

export function deserializePairingMessage(text: string): PairingMessage {
  const parsed = JSON.parse(text) as SerializedHello;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('pairing message: not an object');
  }
  if (parsed.v !== PAIRING_PROTOCOL_VERSION) {
    throw new Error(`pairing message: unsupported version ${parsed.v}`);
  }
  if (parsed.kind !== 'hello') {
    throw new Error(`pairing message: unknown kind ${(parsed as { kind: string }).kind}`);
  }
  return {
    kind: 'hello',
    identityPub: hexToBytes(parsed.identityPub),
    ephemeralPub: hexToBytes(parsed.ephemeralPub),
  };
}

function serialized(msg: PairingMessage): SerializedHello {
  return {
    v: PAIRING_PROTOCOL_VERSION,
    kind: 'hello',
    identityPub: bytesToHex(msg.identityPub),
    ephemeralPub: bytesToHex(msg.ephemeralPub),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('pairing message: malformed hex');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) throw new Error('pairing message: malformed hex');
    out[i] = b;
  }
  return out;
}
