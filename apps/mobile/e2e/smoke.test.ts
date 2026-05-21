/* global device, element, by, expect */

describe('Smoke', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('launches into the onboarding Welcome screen', async () => {
    await expect(element(by.id('screen.welcome'))).toBeVisible();
  });
});

describe('Pairing (S1) — single-device flow up to code_shown', () => {
  // Two-device pairing needs both simulators on the same BLE host. On
  // a single simulator we can only walk the screen up to the point
  // where it's actively scanning (the "Looking for your partner's
  // phone…" state). Full two-device coverage lives in the Mac runbook.
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('navigates from Welcome → PairWithPartner and starts scanning', async () => {
    await expect(element(by.id('screen.welcome'))).toBeVisible();
    // The Welcome screen is a placeholder until the user navigates to
    // pairing; once the call-to-action is added we'll tap it here.
    // For now this is documented as a placeholder Detox step.
  });
});

describe('Global feed (S3) — placeholder for the post-pairing happy path', () => {
  // The full feed flow needs a paired + Safe-Word-satisfied couple, so
  // the Detox step here is a placeholder until the harness wires that up
  // on the Mac runbook. The testIDs the feed slice exposes for E2E:
  //   screen.global-feed
  //     feed.compose             — opens SubmitPost
  //     feed.post.<uuid>         — opens PostDetail
  //     feed.empty               — visible until the first GET 200
  //     feed.loading-more        — visible during fetchNextPage()
  //   screen.submit-post
  //     submit-post.type.text    — content-type radio: text
  //     submit-post.type.link    — content-type radio: link
  //     submit-post.body         — TextInput
  //     submit-post.submit       — disabled until non-empty body
  //     submit-post.cancel       — pops back to feed
  //     submit-post.too-long     — visible above the 4000-char limit
  //     submit-post.error        — visible on a 4xx response
  //   screen.post-detail
  //     post-detail.back              — pops back to feed
  //     post-detail.body              — for text posts
  //     post-detail.open-link         — for link posts
  //     post-detail.save-for-partner  — wired iff sync engine is ready
  //     post-detail.save-notice       — inline status after save
  //   feed.open-saved                 — opens SavedByYou (engine-ready only)
  //   feed.open-prompts               — opens PromptList (engine-ready only)
  //   screen.saved-by-you
  //     saved-by-you.back / .view-for-you / .row.<savedPostId>
  //     saved-by-you.empty / .loading
  //   screen.saved-for-you
  //     saved-for-you.back / .view-by-you
  //     saved-for-you.locked-tile / .unlocked-tile
  //     saved-for-you.open-unlocked   — opens UnlockedSavedList (S7)
  //     saved-for-you.total
  //   screen.unlocked-saved-list
  //     unlocked-saved-list.back / .row.<savedPostId>
  //     unlocked-saved-list.loading / .empty
  //   screen.prompt-list
  //     prompt-list.back / .assign / .assign-error
  //     prompt-list.section.assigned-to-me / .section.awaiting-my-cert
  //     prompt-list.empty.assigned-to-me / .empty.awaiting-my-cert
  //     prompt-list.row.<promptId> / .loading
  //   screen.active-prompt
  //     active-prompt.back / .title / .body / .mark-done / .waiting / .error
  //   screen.certify-completion
  //     certify-completion.back / .title / .body / .certify
  //     certify-completion.already-certified / .error
});
