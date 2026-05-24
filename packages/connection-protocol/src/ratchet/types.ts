/**
 * Side identifier for the connection channel. The pairing handshake establishes
 * a single 32-byte root key shared by both partners; from there we derive
 * two independent symmetric ratchet chains, one per direction. Both sides
 * must agree on who is 'a' and who is 'b' so the chains line up; the
 * convention is to sort the two long-term identity pubkeys lexicographically
 * and assign 'a' to the smaller, 'b' to the larger.
 */
export type ConnectionSide = 'a' | 'b';

/**
 * In-memory state for one partner's connection channel. The two chain keys are
 * the load-bearing secrets — they ratchet forward on every message and
 * grant forward secrecy: compromising a chain key after the fact does not
 * reveal earlier message keys.
 *
 * Phase-1 note: this implements the SYMMETRIC half of the Signal Double
 * Ratchet only (the chain ratchet). The Diffie-Hellman ratchet, which
 * gives post-compromise security on top of forward secrecy, is deferred
 * to Phase 2. The wire format already carries a version byte so we can
 * extend the header with a DH pubkey without breaking existing devices.
 */
export interface RatchetState {
  /** Outgoing chain — advances on every `ratchetEncrypt`. */
  sendingChainKey: Uint8Array;
  sendingCounter: number;
  /** Incoming chain — advances on every successful `ratchetDecrypt`. */
  receivingChainKey: Uint8Array;
  receivingCounter: number;
  /**
   * Skipped message keys, keyed by their counter. Populated when an
   * envelope arrives out of order (counter > receivingCounter): the
   * intermediate keys are materialised + cached so the eventual delivery
   * of the lower-counter envelopes still decrypts. Bounded by
   * MAX_SKIPPED_MESSAGE_KEYS so an attacker can't grow the cache.
   */
  skipped: Map<number, Uint8Array>;
}

export interface EncryptedEnvelope {
  /** Serialised header bytes (see ratchet/header.ts). */
  header: Uint8Array;
  /** AEAD ciphertext (XChaCha20-Poly1305). Includes the 16-byte tag. */
  ciphertext: Uint8Array;
}

export const RATCHET_HEADER_VERSION = 1;
export const MAX_SKIPPED_MESSAGE_KEYS = 1000;
