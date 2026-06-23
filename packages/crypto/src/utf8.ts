/**
 * Dependency-free UTF-8 codec.
 *
 * Why this exists: the connection-protocol op path (serialiseOp /
 * deserialiseOp) reached for the global `TextEncoder` / `TextDecoder`. On
 * Hermes (React Native) `TextEncoder` is present but `TextDecoder` is NOT,
 * so `deserialiseOp` threw `Property 'TextDecoder' doesn't exist` on every
 * flush()/pull() — meaning no couple-channel op could ever be encrypted+sent
 * or decrypted+applied on device (the "partner notes don't transfer" bug).
 * Routing both directions through these functions removes the runtime-global
 * dependency entirely, so the package behaves identically under Node (tests),
 * Hermes, and any other JS engine.
 *
 * The byte output is standard UTF-8, byte-for-byte identical to
 * `new TextEncoder().encode(...)`, so it stays wire-compatible with ops
 * produced by an older build or by the Node-side API.
 */

/** Encode a JS string to its UTF-8 bytes (full Unicode, incl. surrogate pairs). */
export function utf8Encode(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    // Combine a high+low surrogate into a single code point (e.g. emoji).
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Decode UTF-8 bytes back to a JS string. Inverse of {@link utf8Encode}. */
export function utf8Decode(bytes: Uint8Array): string {
  // Accumulate code units in chunks to avoid a huge spread into
  // String.fromCharCode (stack overflow on large inputs) while staying
  // faster than char-by-char string concatenation.
  let out = '';
  let chunk: number[] = [];
  let i = 0;
  const flush = (): void => {
    if (chunk.length === 0) return;
    out += String.fromCharCode(...chunk);
    chunk = [];
  };
  while (i < bytes.length) {
    const b0 = bytes[i++] as number;
    let code: number;
    if (b0 < 0x80) {
      code = b0;
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      code = ((b0 & 0x1f) << 6) | ((bytes[i++] as number) & 0x3f);
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = bytes[i++] as number;
      const b2 = bytes[i++] as number;
      code = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
    } else {
      const b1 = bytes[i++] as number;
      const b2 = bytes[i++] as number;
      const b3 = bytes[i++] as number;
      code = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
    }
    if (code > 0xffff) {
      // Split an astral code point back into a surrogate pair.
      code -= 0x10000;
      chunk.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      chunk.push(code);
    }
    if (chunk.length >= 0x1000) flush();
  }
  flush();
  return out;
}
