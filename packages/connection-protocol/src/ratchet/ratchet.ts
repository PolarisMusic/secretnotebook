import { aeadDecrypt, aeadEncrypt, hkdfSha256, hmacSha256 } from '@secretnotebook/crypto';
import { decodeHeader, encodeHeader } from './header.js';
import {
  MAX_SKIPPED_MESSAGE_KEYS,
  type ConnectionSide,
  type EncryptedEnvelope,
  type RatchetState,
} from './types.js';

const CHAIN_AB_INFO = new TextEncoder().encode('secretnotebook/connection-channel/a->b/v1');
const CHAIN_BA_INFO = new TextEncoder().encode('secretnotebook/connection-channel/b->a/v1');

// Inputs to the per-step HMAC. Two different constants so the chain-key
// successor and the per-message key derived from the same chain key are
// independent.
const HMAC_LABEL_NEXT_CHAIN = new TextEncoder().encode('next-chain');
const HMAC_LABEL_MESSAGE_KEY = new TextEncoder().encode('message-key');

// AEAD material derived from the per-message key. 32-byte XChaCha20 key +
// 24-byte nonce — single-use because the chain ratchet never repeats a
// message key.
const AEAD_MATERIAL_INFO = new TextEncoder().encode('secretnotebook/connection-channel/aead/v1');
const AEAD_KEY_BYTES = 32;
const AEAD_NONCE_BYTES = 24;
const AEAD_MATERIAL_BYTES = AEAD_KEY_BYTES + AEAD_NONCE_BYTES;

/**
 * Initialise both ratchets from the 32-byte connection root key. The two
 * chain keys are derived with domain-separated HKDF info strings so the
 * sending and receiving chains never collide.
 *
 * `side` resolves which of the two chains is outgoing vs incoming:
 *   - side 'a': sending = a->b, receiving = b->a
 *   - side 'b': sending = b->a, receiving = a->b
 * Both partners must agree on the split — the pairing layer assigns the
 * sides lexicographically so the agreement is deterministic.
 */
export async function initRatchetForConnectionSide(
  rootKey: Uint8Array,
  side: ConnectionSide,
): Promise<RatchetState> {
  if (rootKey.length !== 32) {
    throw new Error('connection root key must be 32 bytes');
  }
  const chainAB = await hkdfSha256(rootKey, null, CHAIN_AB_INFO, 32);
  const chainBA = await hkdfSha256(rootKey, null, CHAIN_BA_INFO, 32);
  const sending = side === 'a' ? chainAB : chainBA;
  const receiving = side === 'a' ? chainBA : chainAB;
  return {
    sendingChainKey: sending,
    sendingCounter: 0,
    receivingChainKey: receiving,
    receivingCounter: 0,
    skipped: new Map(),
  };
}

interface AdvancedChain {
  nextChainKey: Uint8Array;
  messageKey: Uint8Array;
}

async function advanceChain(chainKey: Uint8Array): Promise<AdvancedChain> {
  const nextChainKey = await hmacSha256(chainKey, HMAC_LABEL_NEXT_CHAIN);
  const messageKey = await hmacSha256(chainKey, HMAC_LABEL_MESSAGE_KEY);
  return { nextChainKey, messageKey };
}

interface AeadMaterial {
  aeadKey: Uint8Array;
  nonce: Uint8Array;
}

async function deriveAeadMaterial(messageKey: Uint8Array): Promise<AeadMaterial> {
  const material = await hkdfSha256(messageKey, null, AEAD_MATERIAL_INFO, AEAD_MATERIAL_BYTES);
  return {
    aeadKey: material.subarray(0, AEAD_KEY_BYTES),
    nonce: material.subarray(AEAD_KEY_BYTES, AEAD_MATERIAL_BYTES),
  };
}

/**
 * Encrypt a CRDT op (any byte string) for the partner. Mutates `state` in
 * place: bumps `sendingCounter`, ratchets `sendingChainKey`. The header is
 * a 5-byte version + counter, used both as plaintext on the wire and as
 * AEAD associated data — tampering with it fails decryption.
 */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array,
): Promise<EncryptedEnvelope> {
  const { nextChainKey, messageKey } = await advanceChain(state.sendingChainKey);
  const counter = state.sendingCounter;
  const header = encodeHeader(counter);
  const { aeadKey, nonce } = await deriveAeadMaterial(messageKey);
  const { ciphertext } = await aeadEncrypt(plaintext, aeadKey, header, nonce);
  state.sendingChainKey = nextChainKey;
  state.sendingCounter += 1;
  return { header, ciphertext };
}

/**
 * Decrypt an inbound envelope.
 *
 * Handles three counter orderings vs the receiver's current position:
 *   - counter < receivingCounter
 *       * if the key was stashed in `skipped` (out-of-order earlier), use
 *         it and forget. Otherwise this is a replay → throw.
 *   - counter === receivingCounter (in-order)
 *       * advance the chain once and decrypt.
 *   - counter > receivingCounter (later message arrived first)
 *       * advance the chain (counter - receivingCounter) times, stashing
 *         each skipped message key into `skipped`, then advance once
 *         more to materialise this one. Cache is bounded so the loop
 *         can't run forever on garbage.
 */
export async function ratchetDecrypt(
  state: RatchetState,
  header: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const parsed = decodeHeader(header);
  const counter = parsed.counter;

  if (counter < state.receivingCounter) {
    const cached = state.skipped.get(counter);
    if (!cached) {
      throw new Error(`ratchet: replayed or already-consumed counter ${counter}`);
    }
    state.skipped.delete(counter);
    const { aeadKey, nonce } = await deriveAeadMaterial(cached);
    return aeadDecrypt(ciphertext, nonce, aeadKey, header);
  }

  const gap = counter - state.receivingCounter;
  if (gap > MAX_SKIPPED_MESSAGE_KEYS) {
    throw new Error(`ratchet: skipped-key gap of ${gap} exceeds limit`);
  }
  if (state.skipped.size + gap > MAX_SKIPPED_MESSAGE_KEYS) {
    throw new Error(
      `ratchet: skipped-key cache (${state.skipped.size}) + gap (${gap}) would exceed limit`,
    );
  }

  // Materialise skipped keys for any envelopes still in flight.
  while (state.receivingCounter < counter) {
    const { nextChainKey, messageKey } = await advanceChain(state.receivingChainKey);
    state.skipped.set(state.receivingCounter, messageKey);
    state.receivingChainKey = nextChainKey;
    state.receivingCounter += 1;
  }

  // Now state.receivingCounter === counter.
  const { nextChainKey, messageKey } = await advanceChain(state.receivingChainKey);
  state.receivingChainKey = nextChainKey;
  state.receivingCounter += 1;

  const { aeadKey, nonce } = await deriveAeadMaterial(messageKey);
  return aeadDecrypt(ciphertext, nonce, aeadKey, header);
}
