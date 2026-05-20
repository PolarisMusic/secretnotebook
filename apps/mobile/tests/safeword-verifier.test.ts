import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';
import { bytesToHex } from '@secretnotebook/crypto';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { persistCouple } from '../src/features/pairing/persistence';
import {
  deriveCoupleSafeWord,
  deriveSafeWordSalt,
  saveSafeWord,
  verifyCoupleSafeWord,
} from '../src/features/safeword/verifier';
import { nodeExecutor } from './helpers/sqlite-executor';

// Argon2id at the documented mobile params is too slow for unit tests
// (~500 ms each). Use the libsodium minimum here; the crypto package
// already pins KAT vectors against the production params.
const FAST_PARAMS = { opslimit: 1, memlimit: 8192 };

const rootKey = new Uint8Array(32).fill(0x42);
const selfPub = new Uint8Array(32).fill(0x01);
const peerPub = new Uint8Array(32).fill(0x02);

async function freshPairedCouple() {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  const { coupleId } = await persistCouple(exec, { rootKey, selfPub, peerPub });
  return { db, exec, coupleId };
}

interface CoupleRow {
  status: string;
  safeword_verifier: Buffer | null;
  safeword_salt: Buffer | null;
}

describe('deriveSafeWordSalt', () => {
  it('is deterministic from root_key', async () => {
    const a = await deriveSafeWordSalt(rootKey);
    const b = await deriveSafeWordSalt(rootKey);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    expect(a.length).toBe(16);
  });

  it('differs for different root_keys', async () => {
    const a = await deriveSafeWordSalt(rootKey);
    const b = await deriveSafeWordSalt(new Uint8Array(32).fill(0x43));
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('rejects a wrong-size root_key', async () => {
    await expect(deriveSafeWordSalt(new Uint8Array(16))).rejects.toThrow(/rootKey/);
  });
});

describe('deriveCoupleSafeWord', () => {
  it('produces byte-identical material on both sides (matching word)', async () => {
    const sideA = await deriveCoupleSafeWord(rootKey, 'orchid-canyon-saffron', FAST_PARAMS);
    const sideB = await deriveCoupleSafeWord(rootKey, 'orchid-canyon-saffron', FAST_PARAMS);
    expect(bytesToHex(sideA.salt)).toBe(bytesToHex(sideB.salt));
    expect(bytesToHex(sideA.verifier)).toBe(bytesToHex(sideB.verifier));
  });

  it('produces different verifiers for different safewords', async () => {
    const a = await deriveCoupleSafeWord(rootKey, 'one', FAST_PARAMS);
    const b = await deriveCoupleSafeWord(rootKey, 'two', FAST_PARAMS);
    expect(bytesToHex(a.verifier)).not.toBe(bytesToHex(b.verifier));
  });

  it('NFKC-normalises so visually-equal words match', async () => {
    const composed = await deriveCoupleSafeWord(rootKey, 'éclipse', FAST_PARAMS);
    const decomposed = await deriveCoupleSafeWord(rootKey, 'éclipse', FAST_PARAMS);
    expect(bytesToHex(composed.verifier)).toBe(bytesToHex(decomposed.verifier));
  });
});

describe('saveSafeWord + verifyCoupleSafeWord', () => {
  it('promotes couple to paired and accepts the correct word', async () => {
    const { db, exec, coupleId } = await freshPairedCouple();
    const material = await deriveCoupleSafeWord(rootKey, 'forest-river-quartz', FAST_PARAMS);
    await saveSafeWord(exec, coupleId, material);

    const row = db.prepare('SELECT * FROM couple WHERE id = ?').get(coupleId) as CoupleRow;
    expect(row.status).toBe('paired');
    expect(row.safeword_verifier).not.toBeNull();
    expect(row.safeword_salt).not.toBeNull();

    const ok = await verifyCoupleSafeWord(exec, coupleId, 'forest-river-quartz', FAST_PARAMS);
    expect(ok).toBe(true);
  });

  it('rejects the wrong word with the same coupleId', async () => {
    const { exec, coupleId } = await freshPairedCouple();
    const material = await deriveCoupleSafeWord(rootKey, 'right', FAST_PARAMS);
    await saveSafeWord(exec, coupleId, material);
    const ok = await verifyCoupleSafeWord(exec, coupleId, 'wrong', FAST_PARAMS);
    expect(ok).toBe(false);
  });

  it('does not advance to paired if the couple is in an unexpected state', async () => {
    const { db, exec, coupleId } = await freshPairedCouple();
    db.prepare(`UPDATE couple SET status = 'severed' WHERE id = ?`).run(coupleId);
    const material = await deriveCoupleSafeWord(rootKey, 'late', FAST_PARAMS);
    await saveSafeWord(exec, coupleId, material);
    const row = db.prepare('SELECT status FROM couple WHERE id = ?').get(coupleId) as CoupleRow;
    expect(row.status).toBe('severed');
  });

  it('rejects verification when the couple is not paired', async () => {
    const { exec, coupleId } = await freshPairedCouple();
    // never call saveSafeWord -> still awaiting_safeword
    const ok = await verifyCoupleSafeWord(exec, coupleId, 'anything', FAST_PARAMS);
    expect(ok).toBe(false);
  });

  it('rejects verification when the coupleId is unknown', async () => {
    const { exec } = await freshPairedCouple();
    const ok = await verifyCoupleSafeWord(exec, 'no-such-id', 'anything', FAST_PARAMS);
    expect(ok).toBe(false);
  });

  it('rejects an empty candidate without running Argon2id', async () => {
    const { exec, coupleId } = await freshPairedCouple();
    const material = await deriveCoupleSafeWord(rootKey, 'real', FAST_PARAMS);
    await saveSafeWord(exec, coupleId, material);
    const ok = await verifyCoupleSafeWord(exec, coupleId, '', FAST_PARAMS);
    expect(ok).toBe(false);
  });
});
