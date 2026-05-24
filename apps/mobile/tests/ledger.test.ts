import { describe, it } from '@jest/globals';

// Phase-1.5 R0: skipped. The couple-points accrual rules
// (+2 save / +10 certify / +25 loop) and the awardCouplePoints
// helper they sat on were retired with the couple-loop cleanup;
// the ledger table survives as a generic carrier but has no
// writers in R0. Coverage of the generic ledger (sum / list /
// dedup) is reintroduced in a later slice if it ever gets a
// real second `kind` beyond `couple_points`.
describe.skip('couple-points ledger', () => {
  it('TODO restored when the ledger gets a real writer post-refactor', () => undefined);
});
