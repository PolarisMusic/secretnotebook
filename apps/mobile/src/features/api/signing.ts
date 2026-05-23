import {
  bytesToHex,
  ed25519Sign,
  sha256,
  sha256Hex as cryptoSha256Hex,
} from '@secretnotebook/crypto';

export const HEADER_PUBKEY = 'x-device-pubkey';
export const HEADER_SIGNATURE = 'x-signature';
export const HEADER_TIMESTAMP = 'x-timestamp';

export interface BuildSignedRequestArgs {
  method: string;
  /** Path + querystring, e.g. `/v1/posts?limit=20`. Must match what hits the server. */
  url: string;
  /**
   * Request body bytes that will be sent on the wire. Pass `undefined` for
   * requests with no body (GET / DELETE). For POSTs of JSON, pass the exact
   * bytes you'll set as `fetch.body` — the signature is over those bytes,
   * so any post-signing serialization step will break verification.
   */
  bodyBytes: Uint8Array | undefined;
  /** Unix seconds. Must be within the server's drift window (default 5 min). */
  timestampSec: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface SignedHeaders {
  [HEADER_PUBKEY]: string;
  [HEADER_SIGNATURE]: string;
  [HEADER_TIMESTAMP]: string;
}

export function canonicalRequestString(
  method: string,
  path: string,
  bodyHashHex: string,
  timestamp: string,
): string {
  return `${method.toUpperCase()}|${path}|${bodyHashHex}|${timestamp}`;
}

export async function bodyHashHex(body: Uint8Array | undefined): Promise<string> {
  if (!body || body.length === 0) return cryptoSha256Hex(new Uint8Array(0));
  return cryptoSha256Hex(body);
}

// Re-export so callers don't need a second crypto import.
export { sha256 };

/**
 * Compute the canonical signed headers for an outgoing API request. Pure
 * function — no I/O, no clock. The caller picks `timestampSec`. Compose
 * these headers with whatever fetch / XHR / RN networking layer the rest
 * of the client uses.
 */
export async function buildSignedHeaders(args: BuildSignedRequestArgs): Promise<SignedHeaders> {
  const bodyHash = await bodyHashHex(args.bodyBytes);
  const canonical = canonicalRequestString(
    args.method,
    args.url,
    bodyHash,
    String(args.timestampSec),
  );
  const sig = await ed25519Sign(new TextEncoder().encode(canonical), args.privateKey);
  return {
    [HEADER_PUBKEY]: bytesToHex(args.publicKey),
    [HEADER_SIGNATURE]: bytesToHex(sig),
    [HEADER_TIMESTAMP]: String(args.timestampSec),
  };
}
