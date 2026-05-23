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
  let bodyHash: string;
  if (args.body === undefined) bodyHash = sha256Hex(null);
  else if (typeof args.body === 'string') bodyHash = sha256Hex(args.body);
  else bodyHash = sha256Hex(JSON.stringify(args.body));

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
    body: args.body,
    headers: {
      [HEADER_PUBKEY]: bytesToHex(args.publicKey),
      [HEADER_SIGNATURE]: bytesToHex(sig),
      [HEADER_TIMESTAMP]: String(args.timestampSec),
      'content-type': args.body === undefined ? 'application/octet-stream' : 'application/json',
    },
  };
}
