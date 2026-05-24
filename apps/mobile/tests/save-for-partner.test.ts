import { describe, it } from '@jest/globals';

// Phase-1.5 R0: skipped. `saveForPartner` (which mirrored a
// global-feed save into the partner's local DB and accrued
// +2 Connection Points) is retired. The "share something with my
// partner" path is reborn as shared notes in R2; "save a public
// post for myself" becomes a personal pin in a later slice.
// New coverage lands with each replacement.
describe.skip('save-for-partner', () => {
  it('TODO replaced by shared-note round-trip + pin coverage in R2/R3', () => undefined);
});
