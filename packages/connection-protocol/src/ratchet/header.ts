import { RATCHET_HEADER_VERSION } from './types.js';

/**
 * Wire format for the ratchet header. 5 bytes total:
 *   - byte 0: version (currently 1)
 *   - bytes 1..4: counter, big-endian uint32
 * Version 2+ will extend with the sender's ratchet DH pubkey when the
 * Diffie-Hellman half lands; the version byte lets us reject older
 * envelopes against newer state and vice versa.
 */
export const RATCHET_HEADER_LENGTH = 5;

export function encodeHeader(counter: number): Uint8Array {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xff_ff_ff_ff) {
    throw new Error(`ratchet header: counter out of range: ${counter}`);
  }
  const out = new Uint8Array(RATCHET_HEADER_LENGTH);
  out[0] = RATCHET_HEADER_VERSION;
  out[1] = (counter >>> 24) & 0xff;
  out[2] = (counter >>> 16) & 0xff;
  out[3] = (counter >>> 8) & 0xff;
  out[4] = counter & 0xff;
  return out;
}

export interface ParsedHeader {
  version: number;
  counter: number;
}

export function decodeHeader(bytes: Uint8Array): ParsedHeader {
  if (bytes.length !== RATCHET_HEADER_LENGTH) {
    throw new Error(`ratchet header: expected ${RATCHET_HEADER_LENGTH} bytes, got ${bytes.length}`);
  }
  const version = bytes[0]!;
  if (version !== RATCHET_HEADER_VERSION) {
    throw new Error(`ratchet header: unsupported version ${version}`);
  }
  const counter = ((bytes[1]! << 24) | (bytes[2]! << 16) | (bytes[3]! << 8) | bytes[4]!) >>> 0;
  return { version, counter };
}
