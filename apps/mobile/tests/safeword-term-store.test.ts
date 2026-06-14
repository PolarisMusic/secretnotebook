import { describe, expect, it } from '@jest/globals';
import type {
  ConnectionSafeWordConfirmOp,
  ConnectionSafeWordProposeOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import type { SqlExecutor } from '../src/db/executor';
import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { applyCrdtOp } from '../src/features/connection-channel/projector';
import {
  confirmTerm,
  getTermState,
  proposeTerm,
  type TermStoreDeps,
} from '../src/features/safeword/term-store';
import { nodeExecutor } from './helpers/sqlite-executor';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const A_PUB = new Uint8Array(32).fill(0x10);
const B_PUB = new Uint8Array(32).fill(0x20);
const STRANGER_PUB = new Uint8Array(32).fill(0xee);
const ROOT_KEY = new Uint8Array(32).fill(0xab);
const FIXED_NOW = new Date('2026-06-14T09:00:00.000Z');

type TermOp = ConnectionSafeWordProposeOp | ConnectionSafeWordConfirmOp;

interface Device {
  exec: SqlExecutor;
  deps: TermStoreDeps;
  enqueued: TermOp[];
}

async function freshDevice(self: Uint8Array): Promise<Device> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  await exec.execute(
    `INSERT INTO connection (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [CONNECTION_ID, A_PUB, B_PUB, ROOT_KEY, 1_700_000_000, 'paired'],
  );
  const enqueued: TermOp[] = [];
  const deps: TermStoreDeps = {
    exec,
    selfPubkey: self,
    connectionRoot: ROOT_KEY,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op);
    },
  };
  return { exec, deps, enqueued };
}

describe('safeword term store', () => {
  it('propose stashes the term locally and enqueues only the verifier hash', async () => {
    const a = await freshDevice(A_PUB);
    await proposeTerm(a.deps, 'butterscotch');

    const state = await getTermState(a.exec, A_PUB);
    expect(state.kind).toBe('awaiting_partner');
    if (state.kind === 'awaiting_partner') expect(state.term).toBe('butterscotch');

    expect(a.enqueued).toHaveLength(1);
    const op = a.enqueued[0];
    expect(op.kind).toBe('connection.safeword.propose');
    if (op.kind === 'connection.safeword.propose') {
      expect(op.proposerPubkey).toBe(bytesToHex(A_PUB));
      expect(op.verifier).toMatch(/^[0-9a-f]{64}$/);
      // The plaintext word must never ride the wire.
      expect(JSON.stringify(op)).not.toContain('butterscotch');
    }
  });

  it('partner confirms by typing it back; both sides end up set', async () => {
    const a = await freshDevice(A_PUB);
    const b = await freshDevice(B_PUB);

    await proposeTerm(a.deps, 'butterscotch');
    const proposeOp = a.enqueued[0];

    // B receives A's propose (sender = peer = A).
    await applyCrdtOp(b.exec, proposeOp, A_PUB);
    expect((await getTermState(b.exec, B_PUB)).kind).toBe('incoming_proposal');

    // B types the word back — it matches and promotes locally.
    await confirmTerm(b.deps, 'butterscotch');
    const bState = await getTermState(b.exec, B_PUB);
    expect(bState.kind).toBe('set');
    if (bState.kind === 'set') expect(bState.term).toBe('butterscotch');

    const confirmOp = b.enqueued[0];
    expect(confirmOp.kind).toBe('connection.safeword.confirm');

    // A receives B's confirm (sender = peer = B) and promotes its proposal.
    await applyCrdtOp(a.exec, confirmOp, B_PUB);
    const aState = await getTermState(a.exec, A_PUB);
    expect(aState.kind).toBe('set');
    if (aState.kind === 'set') expect(aState.term).toBe('butterscotch');
  });

  it('rejects a wrong candidate and leaves the proposal pending', async () => {
    const a = await freshDevice(A_PUB);
    const b = await freshDevice(B_PUB);
    await proposeTerm(a.deps, 'butterscotch');
    await applyCrdtOp(b.exec, a.enqueued[0], A_PUB);

    await expect(confirmTerm(b.deps, 'wrongword')).rejects.toThrow(/match/i);
    expect((await getTermState(b.exec, B_PUB)).kind).toBe('incoming_proposal');
    expect(b.enqueued).toHaveLength(0);
  });

  it('cannot confirm your own outgoing proposal', async () => {
    const a = await freshDevice(A_PUB);
    await proposeTerm(a.deps, 'butterscotch');
    await expect(confirmTerm(a.deps, 'butterscotch')).rejects.toThrow(/waiting/i);
  });

  it('projector rejects a propose op whose proposer is not the sender', async () => {
    const b = await freshDevice(B_PUB);
    const spoof: ConnectionSafeWordProposeOp = {
      v: 1,
      kind: 'connection.safeword.propose',
      proposerPubkey: bytesToHex(A_PUB),
      verifier: 'ab'.repeat(32),
      proposedAt: 1_700_000_700,
    };
    // Arrives on the ratchet half owned by a stranger, not A.
    await expect(applyCrdtOp(b.exec, spoof, STRANGER_PUB)).rejects.toThrow(/does not match sender/);
  });

  it('change keeps the old term active until the new one is confirmed', async () => {
    const a = await freshDevice(A_PUB);
    const b = await freshDevice(B_PUB);
    // First term, fully confirmed on both.
    await proposeTerm(a.deps, 'butterscotch');
    await applyCrdtOp(b.exec, a.enqueued[0], A_PUB);
    await confirmTerm(b.deps, 'butterscotch');
    await applyCrdtOp(a.exec, b.enqueued[0], B_PUB);

    // A proposes a change — A's view goes to awaiting, but the stored term
    // is untouched until confirmation.
    await proposeTerm(a.deps, 'pineapple');
    expect((await getTermState(a.exec, A_PUB)).kind).toBe('awaiting_partner');
    const stillOld = await a.exec.query<{ safeword_term: string | null }>(
      `SELECT safeword_term FROM connection WHERE id = ?`,
      [CONNECTION_ID],
    );
    expect(stillOld[0]?.safeword_term).toBe('butterscotch');

    // B confirms the new word; both converge on it.
    await applyCrdtOp(b.exec, a.enqueued[1], A_PUB);
    await confirmTerm(b.deps, 'pineapple');
    await applyCrdtOp(a.exec, b.enqueued[1], B_PUB);
    const finalA = await getTermState(a.exec, A_PUB);
    expect(finalA.kind).toBe('set');
    if (finalA.kind === 'set') expect(finalA.term).toBe('pineapple');
  });
});
