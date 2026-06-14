import type {
  ConnectionSafeWordConfirmOp,
  ConnectionSafeWordProposeOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex, constantTimeEqual } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { deriveConnectionSafeWord } from './verifier';

/** Length bounds for a roleplay term, mirroring the old DefineSafeWord input. */
export const SAFEWORD_TERM_MIN = 4;
export const SAFEWORD_TERM_MAX = 64;

/**
 * What the UI needs to render the term section. The term is a shared,
 * mutually-known word — it gates nothing; this state only drives the
 * propose → "type it back to match" → confirm handshake and display.
 */
export type SafeWordTermState =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'awaiting_partner';
      readonly term: string | null;
      readonly proposedAt: number | null;
    }
  | { readonly kind: 'incoming_proposal'; readonly proposedAt: number | null }
  | { readonly kind: 'set'; readonly term: string | null; readonly confirmedAt: number };

type SafeWordTermOp = ConnectionSafeWordProposeOp | ConnectionSafeWordConfirmOp;

export interface TermStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  /** The 32-byte connection root (from `engine.connectionRoot`); the salt is
   *  derived from it deterministically, so both sides match the same word. */
  readonly connectionRoot: Uint8Array;
  readonly enqueue: (op: SafeWordTermOp) => Promise<void>;
  readonly now?: () => Date;
}

interface ConnRow {
  id: string;
  partner_a_pubkey: Uint8Array | ArrayBufferLike;
  partner_b_pubkey: Uint8Array | ArrayBufferLike;
  safeword_term: string | null;
  safeword_confirmed_at: number | null;
  safeword_proposal_verifier: Uint8Array | ArrayBufferLike | null;
  safeword_proposal_by: Uint8Array | ArrayBufferLike | null;
  safeword_proposal_at: number | null;
  safeword_proposal_term: string | null;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function nowSec(deps: Pick<TermStoreDeps, 'now'>): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

async function loadConn(exec: SqlExecutor): Promise<ConnRow | null> {
  // Mirror role-store: at most one active connection; pick the most
  // recently paired non-severed row as a defensive tie-break.
  const rows = await exec.query<ConnRow>(
    `SELECT id, partner_a_pubkey, partner_b_pubkey,
            safeword_term, safeword_confirmed_at,
            safeword_proposal_verifier, safeword_proposal_by,
            safeword_proposal_at, safeword_proposal_term
       FROM connection
      WHERE status != 'severed'
      ORDER BY paired_at DESC
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

function assertSelfIsPartner(conn: ConnRow, selfPubkey: Uint8Array): void {
  const isA = sameBytes(selfPubkey, bytesFromRow(conn.partner_a_pubkey));
  const isB = sameBytes(selfPubkey, bytesFromRow(conn.partner_b_pubkey));
  if (!isA && !isB) {
    throw new Error('safeword term: self pubkey does not match either partner on this connection');
  }
}

/**
 * Propose (or change) the roleplay term. Derives the verifier locally,
 * stashes the proposal + plaintext (proposer-side, promoted on confirm), and
 * enqueues a `connection.safeword.propose` op carrying only the verifier
 * hash. The existing active term (if any) stays until the partner confirms.
 * Local UPDATE + enqueue share a transaction so a crash can't desync them.
 */
export async function proposeTerm(deps: TermStoreDeps, word: string): Promise<void> {
  const trimmed = word.trim();
  if (trimmed.length < SAFEWORD_TERM_MIN || trimmed.length > SAFEWORD_TERM_MAX) {
    throw new Error(`Term must be ${SAFEWORD_TERM_MIN}–${SAFEWORD_TERM_MAX} characters`);
  }
  const conn = await loadConn(deps.exec);
  if (!conn) throw new Error('proposeTerm: no active connection');
  assertSelfIsPartner(conn, deps.selfPubkey);

  const { salt, verifier } = await deriveConnectionSafeWord(deps.connectionRoot, trimmed);
  const at = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `UPDATE connection
          SET safeword_salt              = ?,
              safeword_proposal_verifier = ?,
              safeword_proposal_by       = ?,
              safeword_proposal_at       = ?,
              safeword_proposal_term     = ?
        WHERE id = ?`,
      [salt, verifier, deps.selfPubkey, at, trimmed, conn.id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'connection.safeword.propose',
      proposerPubkey: bytesToHex(deps.selfPubkey),
      verifier: bytesToHex(verifier),
      proposedAt: at,
    });
  });
}

/**
 * Confirm a partner's pending proposal by typing the word back. Re-derives
 * the verifier and constant-time-compares against the stashed proposal; on a
 * match, promotes it to the active term and enqueues a
 * `connection.safeword.confirm` op. Throws on mismatch (the caller applies
 * the shared lockout policy) and on a missing / own proposal.
 */
export async function confirmTerm(deps: TermStoreDeps, candidate: string): Promise<void> {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) throw new Error('Enter the term your partner proposed');

  const conn = await loadConn(deps.exec);
  if (!conn) throw new Error('confirmTerm: no active connection');
  assertSelfIsPartner(conn, deps.selfPubkey);

  if (!conn.safeword_proposal_verifier || !conn.safeword_proposal_by) {
    throw new Error('No proposal to confirm');
  }
  if (sameBytes(bytesFromRow(conn.safeword_proposal_by), deps.selfPubkey)) {
    throw new Error('Waiting for your partner to confirm');
  }

  const { salt, verifier } = await deriveConnectionSafeWord(deps.connectionRoot, trimmed);
  if (!constantTimeEqual(verifier, bytesFromRow(conn.safeword_proposal_verifier))) {
    throw new Error("That doesn't match the term your partner set");
  }

  const at = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `UPDATE connection
          SET safeword_verifier          = ?,
              safeword_salt              = ?,
              safeword_term              = ?,
              safeword_confirmed_at      = ?,
              safeword_proposal_verifier = NULL,
              safeword_proposal_by       = NULL,
              safeword_proposal_at       = NULL,
              safeword_proposal_term     = NULL
        WHERE id = ?`,
      [verifier, salt, trimmed, at, conn.id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'connection.safeword.confirm',
      confirmerPubkey: bytesToHex(deps.selfPubkey),
      confirmedAt: at,
    });
  });
}

/** Snapshot of the term/handshake state for the UI. */
export async function getTermState(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<SafeWordTermState> {
  const conn = await loadConn(exec);
  if (!conn) return { kind: 'none' };

  if (conn.safeword_proposal_by) {
    const by = bytesFromRow(conn.safeword_proposal_by);
    if (sameBytes(by, selfPubkey)) {
      return {
        kind: 'awaiting_partner',
        term: conn.safeword_proposal_term,
        proposedAt: conn.safeword_proposal_at,
      };
    }
    return { kind: 'incoming_proposal', proposedAt: conn.safeword_proposal_at };
  }

  if (conn.safeword_confirmed_at != null) {
    return { kind: 'set', term: conn.safeword_term, confirmedAt: conn.safeword_confirmed_at };
  }
  return { kind: 'none' };
}
