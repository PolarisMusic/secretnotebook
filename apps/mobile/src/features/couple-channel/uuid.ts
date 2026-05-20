import { getSodium } from '@secretnotebook/crypto';

/**
 * UUID v4 generator backed by libsodium's randombytes_buf so we don't
 * depend on `node:crypto` (unavailable on react-native) or on a third-
 * party uuid lib. 16 random bytes → version + variant nibbles patched
 * in → standard 8-4-4-4-12 hex layout.
 */
export async function randomUuidV4(): Promise<string> {
  const sodium = await getSodium();
  const b = sodium.randombytes_buf(16);
  // Version 4: top nibble of byte 6 = 0100.
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  // Variant 10x: top two bits of byte 8 = 10xx.
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push((b[i] as number).toString(16).padStart(2, '0'));
  }
  return (
    `${hex.slice(0, 4).join('')}-` +
    `${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-` +
    `${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}
