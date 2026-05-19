import { concatBytes, getSodium } from './sodium.js';
import { x25519DH } from './x25519.js';
import { hkdfSha256 } from './hkdf.js';
import { constantTimeEqual } from './hmac.js';

export const ROOT_KEY_BYTES = 32;
const ROOT_KEY_INFO = new TextEncoder().encode('secretnotebook/couple-root/v1');

export interface HandshakeInputs {
  readonly selfIdentityPrivate: Uint8Array;
  readonly selfEphemeralPrivate: Uint8Array;
  readonly selfIdentityPublic: Uint8Array;
  readonly peerIdentityPublic: Uint8Array;
  readonly peerEphemeralPublic: Uint8Array;
}

function pickFirst(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return a.length < b.length;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av !== bv) return av < bv;
  }
  return false;
}

export async function deriveRootKey(inputs: HandshakeInputs): Promise<Uint8Array> {
  const {
    selfIdentityPrivate,
    selfEphemeralPrivate,
    selfIdentityPublic,
    peerIdentityPublic,
    peerEphemeralPublic,
  } = inputs;

  if (constantTimeEqual(selfIdentityPublic, peerIdentityPublic)) {
    throw new Error('peer identity must differ from self');
  }

  const selfIsFirst = pickFirst(selfIdentityPublic, peerIdentityPublic);

  let dh1: Uint8Array;
  let dh2: Uint8Array;
  let dh3: Uint8Array;

  if (selfIsFirst) {
    dh1 = await x25519DH(selfIdentityPrivate, peerEphemeralPublic);
    dh2 = await x25519DH(selfEphemeralPrivate, peerIdentityPublic);
    dh3 = await x25519DH(selfEphemeralPrivate, peerEphemeralPublic);
  } else {
    dh1 = await x25519DH(selfEphemeralPrivate, peerIdentityPublic);
    dh2 = await x25519DH(selfIdentityPrivate, peerEphemeralPublic);
    dh3 = await x25519DH(selfEphemeralPrivate, peerEphemeralPublic);
  }

  const ikm = concatBytes(dh1, dh2, dh3);
  const firstPub = selfIsFirst ? selfIdentityPublic : peerIdentityPublic;
  const secondPub = selfIsFirst ? peerIdentityPublic : selfIdentityPublic;
  const info = concatBytes(ROOT_KEY_INFO, firstPub, secondPub);

  return hkdfSha256(ikm, null, info, ROOT_KEY_BYTES);
}

export async function pairingCode(
  pubkeyA: Uint8Array,
  pubkeyB: Uint8Array,
  digits = 6,
): Promise<string> {
  const sodium = await getSodium();
  const first = pickFirst(pubkeyA, pubkeyB) ? pubkeyA : pubkeyB;
  const second = pickFirst(pubkeyA, pubkeyB) ? pubkeyB : pubkeyA;
  const digest = sodium.crypto_hash_sha256(concatBytes(first, second));
  const truncated =
    (digest[0] as number) * 65536 + (digest[1] as number) * 256 + (digest[2] as number);
  return truncated.toString(10).padStart(digits, '0').slice(-digits);
}
