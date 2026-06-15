import { bytesToHex, ed25519Sign } from '@secretnotebook/crypto';
import {
  canonicalRequestString,
  HEADER_PUBKEY,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  sha256Hex,
} from '../../src/auth/http-signature.js';

export interface SignInputArgs {
  method: string;
  url: string;
  body?: unknown;
  timestampSec: number;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface SignedRequestParts {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

export async function buildSignedRequest(args: SignInputArgs): Promise<SignedRequestParts> {
  const isBinary = args.body instanceof Uint8Array;
  let bodyHash: string;
  let contentType: string;
  let payload: unknown;
  if (args.body === undefined) {
    bodyHash = sha256Hex(null);
    contentType = 'application/octet-stream';
    payload = undefined;
  } else if (isBinary) {
    const bytes = args.body as Uint8Array;
    bodyHash = sha256Hex(bytes);
    contentType = 'application/octet-stream';
    payload = Buffer.from(bytes);
  } else if (typeof args.body === 'string') {
    bodyHash = sha256Hex(args.body);
    contentType = 'application/json';
    payload = args.body;
  } else {
    bodyHash = sha256Hex(JSON.stringify(args.body));
    contentType = 'application/json';
    payload = args.body;
  }

  const canonical = canonicalRequestString(
    args.method,
    args.url,
    bodyHash,
    String(args.timestampSec),
  );
  const sig = await ed25519Sign(new TextEncoder().encode(canonical), args.privateKey);

  return {
    method: args.method,
    url: args.url,
    body: payload,
    headers: {
      [HEADER_PUBKEY]: bytesToHex(args.publicKey),
      [HEADER_SIGNATURE]: bytesToHex(sig),
      [HEADER_TIMESTAMP]: String(args.timestampSec),
      'content-type': contentType,
    },
  };
}
