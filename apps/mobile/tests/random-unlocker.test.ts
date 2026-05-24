import { describe, it } from '@jest/globals';

// Phase-1.5 R0: skipped. random-unlocker.ts (which picked one of
// the partner's locked saved_posts on prompt certification) was
// retired with the couple-loop cleanup. The notes-tier unlock
// flow that replaces it is introduced in R2 and gets its own
// coverage (writer-chooses-which-note-to-reveal, attempt
// idempotency, library-challenge snapshot).
describe.skip('random-unlocker', () => {
  it('TODO restored in R2 as part of the new note-unlock state machine', () => undefined);
});
