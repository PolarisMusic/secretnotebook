// React Native platform implementation of the sodium wrapper. Metro picks
// this file over sodium.js when bundling for iOS/Android because of the
// .native.js extension; Node continues to use sodium.ts (createRequire to
// the libsodium-wrappers-sumo CJS build).
//
// react-native-libsodium ships its own native libsodium build (including
// the sumo primitives we depend on, notably crypto_pwhash with Argon2id)
// and is API-compatible with libsodium-wrappers. The runtime `ready`
// promise resolves once the JSI bindings are initialised.

import sodium from 'react-native-libsodium';

export type Sodium = typeof sodium;

let ready: Promise<Sodium> | null = null;

export function getSodium(): Promise<Sodium> {
  if (!ready) {
    ready = sodium.ready.then(() => sodium);
  }
  return ready;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex string must have even length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex at offset ${i * 2}`);
    out[i] = byte;
  }
  return out;
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
