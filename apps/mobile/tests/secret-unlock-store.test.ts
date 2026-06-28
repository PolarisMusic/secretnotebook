import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import { getNote } from '../src/features/notes/store';
import { sumConnectionPoints } from '../src/features/ledger/store';
import {
  cancelUnlock,
  discloseRevealedNoteToAuthor,
  getUnlock,
  maybeAwardReflection,
  reconcileUnlockRewards,
  reflectOnUnlock,
  rejectUnlock,
  startUnlock,
  submitUnlock,
  verifyUnlock,
  type SecretUnlockStoreDeps,
  type UnlockState,
} from '../src/features/secret-unlock/store';
import { nodeExecutor } from './helpers/sqlite-executor';

const SELF = new Uint8Array(32).fill(0x11);
const PEER = new Uint8Array(32).fill(0x22);
const FIXED_NOW = new Date('2026-05-21T08:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);

// Deterministic draw: rng()=0 → first candidate (ORDER BY id ASC).
const RNG_FIRST = (): number => 0;

interface Harness {
  exec: SqlExecutor;
  deps: SecretUnlockStoreDeps;
  enqueued: Array<{ kind: string; [k: string]: unknown }>;
}

async function freshHarness(): Promise<Harness> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  const enqueued: Array<{ kind: string; [k: string]: unknown }> = [];
  const deps: SecretUnlockStoreDeps = {
    exec,
    selfPubkey: SELF,
    peerPubkey: PEER,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op as unknown as { kind: string });
    },
  };
  return { exec, deps, enqueued };
}

async function seedSecret(
  exec: SqlExecutor,
  id: string,
  author: Uint8Array,
  body: string,
): Promise<void> {
  await exec.execute(
    `INSERT INTO note (id, kind, author_pubkey, body, created_at)
     VALUES (?, 'secret', ?, ?, ?)`,
    [id, author, body, FIXED_NOW_SEC],
  );
}

async function seedAttempt(
  exec: SqlExecutor,
  args: {
    id: string;
    author: Uint8Array;
    unlocker: Uint8Array;
    state: UnlockState;
    revealedNoteId?: string;
  },
): Promise<void> {
  await exec.execute(
    `INSERT INTO secret_unlock (
       id, author_pubkey, unlocker_pubkey, prompt_key, state, created_at,
       verified_at, revealed_note_id
     ) VALUES (?, ?, ?, 'pq_unhurried_walk', ?, ?, ?, ?)`,
    [
      args.id,
      args.author,
      args.unlocker,
      args.state,
      FIXED_NOW_SEC,
      args.state === 'revealed' ? FIXED_NOW_SEC : null,
      args.revealedNoteId ?? null,
    ],
  );
}

async function seedReflection(exec: SqlExecutor, attemptId: string, by: Uint8Array): Promise<void> {
  await exec.execute(
    `INSERT INTO secret_unlock_reflection (
       attempt_id, by_pubkey, appreciate, uncomfortable, reflected_at
     ) VALUES (?, ?, 'a', 'b', ?)`,
    [attemptId, by, FIXED_NOW_SEC],
  );
}

const A1 = 'a1111111-1111-4111-8111-111111111111';
const A2 = 'a2222222-2222-4222-8222-222222222222';

describe('secret-unlock store', () => {
  describe('startUnlock', () => {
    it('throws when the partner has no unrevealed secrets', async () => {
      const { deps } = await freshHarness();
      await expect(startUnlock(deps)).rejects.toThrow(/no secret notes to unlock/);
    });

    it('creates an assigned attempt and enqueues a start op', async () => {
      const { exec, deps, enqueued } = await freshHarness();
      await seedSecret(exec, A1, PEER, "partner's secret"); // pool of 1
      const row = await startUnlock(deps, { rng: RNG_FIRST });

      expect(row.state).toBe('assigned');
      expect(bytesToHex(row.authorPubkey)).toBe(bytesToHex(PEER));
      expect(bytesToHex(row.unlockerPubkey)).toBe(bytesToHex(SELF));

      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]).toMatchObject({
        kind: 'secret_unlock.start',
        id: row.id,
        authorPubkey: bytesToHex(PEER),
        unlockerPubkey: bytesToHex(SELF),
        promptKey: 'pq_unhurried_walk',
      });
    });

    it('enforces one active attempt per partner', async () => {
      const { exec, deps } = await freshHarness();
      await seedSecret(exec, A1, PEER, 's');
      await startUnlock(deps, { rng: RNG_FIRST });
      await expect(startUnlock(deps, { rng: RNG_FIRST })).rejects.toThrow(/already have an active/);
    });

    it('caps starts at one per calendar day — even after the first is canceled', async () => {
      const { exec, deps } = await freshHarness();
      await seedSecret(exec, A1, PEER, 's');
      // Start then cancel: the active-attempt guard is now satisfied...
      const first = await startUnlock(deps, { rng: RNG_FIRST });
      await cancelUnlock(deps, first.id);
      // ...but the start still counts against today's one-per-day allowance.
      await expect(startUnlock(deps, { rng: RNG_FIRST })).rejects.toThrow(/one secret a day/);
    });

    it('resets the daily cap once the clock crosses local midnight', async () => {
      const { exec, deps } = await freshHarness();
      await seedSecret(exec, A1, PEER, 's');
      // Day 1: spend the allowance (start + cancel), second start blocked.
      const first = await startUnlock(deps, { rng: RNG_FIRST });
      await cancelUnlock(deps, first.id);
      await expect(startUnlock(deps, { rng: RNG_FIRST })).rejects.toThrow(/one secret a day/);

      // Day 2: advance >24h so we're past local midnight in any timezone.
      const nextDay = new Date(FIXED_NOW.getTime() + 25 * 60 * 60 * 1000);
      const depsNextDay: SecretUnlockStoreDeps = { ...deps, now: () => nextDay };
      const second = await startUnlock(depsNextDay, { rng: RNG_FIRST });
      expect(second.state).toBe('assigned');
    });
  });

  describe('submit / reject', () => {
    it('Unlocker submits: assigned → submitted with a submit op', async () => {
      const { exec, deps, enqueued } = await freshHarness();
      await seedAttempt(exec, { id: A1, author: PEER, unlocker: SELF, state: 'assigned' });
      await submitUnlock(deps, A1);
      expect((await getUnlock(exec, A1))?.state).toBe('submitted');
      expect(enqueued.at(-1)).toMatchObject({ kind: 'secret_unlock.submit', attemptId: A1 });
    });

    it('non-Unlocker cannot submit', async () => {
      const { exec, deps } = await freshHarness();
      await seedAttempt(exec, { id: A1, author: SELF, unlocker: PEER, state: 'assigned' });
      await expect(submitUnlock(deps, A1)).rejects.toThrow(/only the Unlocker/);
    });

    it('Author send-back: submitted → returned, then Unlocker can resubmit', async () => {
      const { exec, deps } = await freshHarness();
      await seedAttempt(exec, { id: A1, author: SELF, unlocker: PEER, state: 'submitted' });
      await rejectUnlock(deps, A1);
      expect((await getUnlock(exec, A1))?.state).toBe('returned');
    });
  });

  describe('verifyUnlock (the blind draw)', () => {
    it('draws a secret, reveals it via the verify op, awards +50, and stays blind on the Author UI', async () => {
      const { exec, deps, enqueued } = await freshHarness();
      // SELF is the Author here; two secrets in the pool.
      await seedSecret(exec, A1, SELF, 'secret one');
      await seedSecret(exec, A2, SELF, 'secret two');
      await seedAttempt(exec, { id: 'att', author: SELF, unlocker: PEER, state: 'submitted' });

      const { revealedNoteId } = await verifyUnlock(deps, 'att', { rng: RNG_FIRST });
      expect(revealedNoteId).toBe(A1); // first by id ASC

      const attempt = await getUnlock(exec, 'att');
      expect(attempt?.state).toBe('revealed');
      expect(attempt?.revealedNoteId).toBe(A1);

      // The verify op carries the body so the Unlocker can read it.
      const verifyOp = enqueued.find((o) => o.kind === 'secret_unlock.verify');
      expect(verifyOp).toMatchObject({ revealedNoteId: A1, body: 'secret one' });

      // +50 awarded (verify) and a ledger op enqueued.
      expect(await sumConnectionPoints(exec)).toBe(50);
      expect(enqueued.some((o) => o.kind === 'ledger_entry.add')).toBe(true);

      // Blind-until-reflection: the Author's own note is NOT revealed yet.
      expect((await getNote(exec, A1))?.revealedAt).toBeNull();
    });

    it('throws when the pool is empty at verify time', async () => {
      const { exec, deps } = await freshHarness();
      await seedAttempt(exec, { id: 'att', author: SELF, unlocker: PEER, state: 'submitted' });
      await expect(verifyUnlock(deps, 'att', { rng: RNG_FIRST })).rejects.toThrow(
        /no secret available/,
      );
    });

    it('only the Author can verify', async () => {
      const { exec, deps } = await freshHarness();
      await seedAttempt(exec, { id: 'att', author: PEER, unlocker: SELF, state: 'submitted' });
      await expect(verifyUnlock(deps, 'att')).rejects.toThrow(/only the Author/);
    });
  });

  describe('cancelUnlock', () => {
    it('Unlocker cancels an active attempt', async () => {
      const { exec, deps, enqueued } = await freshHarness();
      await seedAttempt(exec, { id: A1, author: PEER, unlocker: SELF, state: 'assigned' });
      await cancelUnlock(deps, A1);
      expect((await getUnlock(exec, A1))?.state).toBe('canceled');
      expect(enqueued.at(-1)).toMatchObject({ kind: 'secret_unlock.cancel', attemptId: A1 });
    });

    it('cannot cancel after the reveal', async () => {
      const { exec, deps } = await freshHarness();
      await seedAttempt(exec, {
        id: A1,
        author: PEER,
        unlocker: SELF,
        state: 'revealed',
        revealedNoteId: A2,
      });
      await expect(cancelUnlock(deps, A1)).rejects.toThrow(/too late to cancel/);
    });
  });

  describe('reflection + mutual award', () => {
    it('Author reflecting after the partner already reflected fires the +50 mutual award', async () => {
      const { exec, deps, enqueued } = await freshHarness();
      await seedSecret(exec, A1, SELF, 'the secret');
      await seedAttempt(exec, {
        id: 'att',
        author: SELF,
        unlocker: PEER,
        state: 'revealed',
        revealedNoteId: A1,
      });
      await seedReflection(exec, 'att', PEER); // partner already reflected

      await reflectOnUnlock(deps, 'att', {
        appreciate: 'loved it',
        uncomfortable: 'nothing',
      });

      expect(enqueued.some((o) => o.kind === 'secret_unlock.reflect')).toBe(true);
      // Mutual award fired (only the reflect award here — no verify award seeded).
      expect(await sumConnectionPoints(exec)).toBe(50);
    });

    it('reflecting is idempotent per partner', async () => {
      const { exec, deps, enqueued } = await freshHarness();
      await seedAttempt(exec, {
        id: 'att',
        author: SELF,
        unlocker: PEER,
        state: 'revealed',
        revealedNoteId: A1,
      });
      await reflectOnUnlock(deps, 'att', { appreciate: 'x', uncomfortable: 'y' });
      enqueued.length = 0;
      await reflectOnUnlock(deps, 'att', { appreciate: 'x', uncomfortable: 'y' });
      expect(enqueued).toHaveLength(0);
    });

    it('rejects empty reflection answers', async () => {
      const { exec, deps } = await freshHarness();
      await seedAttempt(exec, {
        id: 'att',
        author: SELF,
        unlocker: PEER,
        state: 'revealed',
        revealedNoteId: A1,
      });
      await expect(
        reflectOnUnlock(deps, 'att', { appreciate: '  ', uncomfortable: 'y' }),
      ).rejects.toThrow(/both reflection answers/);
    });

    it('only the Author writes the mutual award (Unlocker side never does)', async () => {
      const { exec, deps } = await freshHarness();
      // SELF is the Unlocker here.
      await seedAttempt(exec, {
        id: 'att',
        author: PEER,
        unlocker: SELF,
        state: 'revealed',
        revealedNoteId: A1,
      });
      await seedReflection(exec, 'att', PEER);
      await reflectOnUnlock(deps, 'att', { appreciate: 'x', uncomfortable: 'y' });
      // Both have reflected, but SELF is not the Author → no award written here.
      expect(await sumConnectionPoints(exec)).toBe(0);
      // And maybeAwardReflection on the non-author is a no-op too.
      await maybeAwardReflection(deps, 'att');
      expect(await sumConnectionPoints(exec)).toBe(0);
    });
  });

  describe('discloseRevealedNoteToAuthor', () => {
    it("reveals the drawn note on the Author's device (sets revealed_at)", async () => {
      const { exec, deps } = await freshHarness();
      await seedSecret(exec, A1, SELF, 'the secret');
      await seedAttempt(exec, {
        id: 'att',
        author: SELF,
        unlocker: PEER,
        state: 'revealed',
        revealedNoteId: A1,
      });
      expect((await getNote(exec, A1))?.revealedAt).toBeNull();
      await discloseRevealedNoteToAuthor(deps, 'att');
      expect((await getNote(exec, A1))?.revealedAt).not.toBeNull();
    });
  });

  describe('reconcileUnlockRewards', () => {
    it('awards verify + reflection for a revealed, fully-reflected attempt the Author owns; idempotent', async () => {
      const { exec, deps } = await freshHarness();
      await seedAttempt(exec, {
        id: 'att',
        author: SELF,
        unlocker: PEER,
        state: 'revealed',
        revealedNoteId: A1,
      });
      await seedReflection(exec, 'att', SELF);
      await seedReflection(exec, 'att', PEER);

      await reconcileUnlockRewards(deps);
      expect(await sumConnectionPoints(exec)).toBe(100); // 50 verify + 50 reflect

      await reconcileUnlockRewards(deps); // idempotent
      expect(await sumConnectionPoints(exec)).toBe(100);
    });

    it('does not award for attempts the device did not author', async () => {
      const { exec, deps } = await freshHarness();
      await seedAttempt(exec, {
        id: 'att',
        author: PEER,
        unlocker: SELF,
        state: 'revealed',
        revealedNoteId: A1,
      });
      await seedReflection(exec, 'att', SELF);
      await seedReflection(exec, 'att', PEER);
      await reconcileUnlockRewards(deps);
      expect(await sumConnectionPoints(exec)).toBe(0);
    });
  });
});
