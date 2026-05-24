import { describe, it } from '@jest/globals';

// Phase-1.5 R0: skipped. The Phase-1 prompt state-machine
// (assigned → completed → certified → expired) is retired with
// the couple-loop cleanup. The notes model replaces it with a
// per-unlock-attempt lifecycle (drawn → claimed → verified) that
// has its own state-machine coverage in R2.
describe.skip('prompt transitions', () => {
  it('TODO replaced by NoteUnlockAttempt transitions in R2', () => undefined);
});
