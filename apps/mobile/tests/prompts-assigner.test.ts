import { describe, it } from '@jest/globals';

// Phase-1.5 R0: skipped. The Phase-1 per-couple prompt assigner
// (assign / complete / certify state machine) does not map onto
// the notes model. The new flow uses a server-side challenge
// library (R2) that's drawn from on partner-side unlock attempts,
// not an assigner-feeds-assignee model. Coverage is rebuilt
// against the new shape in R2.
describe.skip('prompts assigner', () => {
  it('TODO replaced by the R2 server-challenge-library draw flow', () => undefined);
});
