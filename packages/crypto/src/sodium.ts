import { createRequire } from 'node:module';
import type sodiumTypes from 'libsodium-wrappers-sumo';

// libsodium-wrappers-sumo ships a broken ESM build that references a sibling
// file (./libsodium-sumo.mjs) which is actually a separate package. The CJS
// build resolves correctly, so we pull it in via createRequire on Node. The
// React Native target swaps this module out at the Metro level (see F3).
const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers-sumo') as typeof sodiumTypes;

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
