/* global device, element, by, expect, waitFor */

/**
 * Phase-1 happy-path Detox spec — the canonical end-to-end script
 * the implementation-details.md "Phase 1 end-to-end test" section
 * spells out:
 *
 *   pair (BLE mocked) → Safe Word setup → both submit a post →
 *   save partner's post → assigned prompt completes → partner certifies
 *   → unlock one random post → view post (Safe Word gate) → enactor marks
 *   action done → curator submits private 1–10 rating → both complete
 *   gratitude prompt → Couple Points appear in both ledgers
 *
 * Two-device steps need both simulators on the same BLE-mocked host;
 * those live in the Mac runbook (`RUNBOOK.md`) and ship here as
 * `it.todo()` placeholders with the exact tap script + testIDs the
 * operator follows. Single-sim-reachable steps (Welcome → Pair-start)
 * are live `it()` blocks that run in the CI Detox config.
 *
 * As the harness gains "preset-paired" launch args + a partner-side
 * scripting bridge, the todos flip to live tests one by one — no
 * spec-level restructuring needed.
 *
 * testID conventions for this spec live alongside the smoke spec; the
 * full table is also in RUNBOOK.md.
 */

describe('Phase-1 happy path — verification flow', () => {
  // ---------------------------------------------------------------
  // S1 — Pair (BLE mocked)
  // ---------------------------------------------------------------
  describe('S1 — Pair', () => {
    beforeAll(async () => {
      await device.launchApp({ newInstance: true });
    });

    it('cold launches into the Welcome screen', async () => {
      await expect(element(by.id('screen.welcome'))).toBeVisible();
    });

    it('Welcome.start → screen.pair visible', async () => {
      await element(by.id('welcome.start')).tap();
      await waitFor(element(by.id('screen.pair')))
        .toBeVisible()
        .withTimeout(5_000);
    });

    it('Pair.start → pair.code appears (single-sim half of the BLE handshake)', async () => {
      await element(by.id('pair.start')).tap();
      // Single-sim observable end-state: the device shows its code and
      // is actively scanning. The other half (peer device acceptance,
      // pair.done flip) requires the second simulator.
      await waitFor(element(by.id('pair.code')))
        .toBeVisible()
        .withTimeout(15_000);
    });

    it.todo(
      'TWO-DEVICE: A.pair.start + B.pair.start → matching codes → both reach pair.done (Mac runbook)',
    );
  });

  // ---------------------------------------------------------------
  // S2 — Safe Word
  // ---------------------------------------------------------------
  describe('S2 — Safe Word', () => {
    it.todo('PRECONDITION: both sims at pair.done (Mac runbook §S1)');
    it.todo('A: screen.define_safeword visible after pair.done');
    it.todo('A: safeword.first + safeword.second match + safeword.submit → screen.global-feed');
    it.todo('B: same word in safeword.first + .second → screen.global-feed');
    it.todo('SECURITY: 3× wrong gate.input attempts → gate.locked visible for 30s');
    it.todo(
      'SECURITY: 60s+ background, cold-launch → screen.safeword_gate before screen.global-feed',
    );
    it.todo(
      'SECURITY: biometric prompt fires on gate.submit after a fresh background (Mac runbook §security)',
    );
  });

  // ---------------------------------------------------------------
  // S3 — Global feed + post submission
  // ---------------------------------------------------------------
  describe('S3 — Global feed', () => {
    it.todo('A: screen.global-feed visible after Safe Word satisfied');
    it.todo(
      'A: feed.compose → screen.submit-post → submit-post.type.text + .body + .submit → back to feed',
    );
    it.todo('A: the new feed.post.<uuid> row is visible at the top of the list');
    it.todo('B: pulls feed → same feed.post.<uuid> is visible (after relay sync)');
  });

  // ---------------------------------------------------------------
  // S5 — Save for partner (S4 is the relay channel — observable in S5 onward)
  // ---------------------------------------------------------------
  describe('S5 — Save for partner', () => {
    it.todo(
      'B: feed.post.<id> → screen.post-detail → post-detail.save-for-partner → post-detail.save-notice',
    );
    it.todo('B: feed.open-saved → screen.saved-by-you → saved-by-you.row.<id> visible');
    it.todo(
      'A: feed.open-saved → saved-by-you.view-for-you → screen.saved-for-you → saved-for-you.locked-tile count is 1',
    );
    it.todo('A: saved-for-you.total reflects 1');
    it.todo('A: couple-home.points-tile shows +2 (POINTS_SAVE_FOR_PARTNER)');
    it.todo('B: couple-home.points-tile shows +2 after sync');
  });

  // ---------------------------------------------------------------
  // S6 — Prompts (assign, complete, certify)
  // ---------------------------------------------------------------
  describe('S6 — Prompts', () => {
    it.todo(
      'A: feed.open-prompts → screen.prompt-list → prompt-list.assign → prompt-list.section.awaiting-my-cert grows by 1',
    );
    it.todo('B: prompt-list.section.assigned-to-me has the new prompt');
    it.todo(
      'B: prompt-list.row.<id> → screen.active-prompt → active-prompt.mark-done → active-prompt.waiting',
    );
    it.todo(
      'A: prompt-list.section.awaiting-my-cert.row.<id> → screen.certify-completion → certify-completion.certify',
    );
    it.todo(
      'A: certify-completion.already-certified visible after submit (debounce / idempotency)',
    );
    it.todo('A & B: couple-home.points-tile shows +10 (POINTS_PROMPT_CERTIFIED) on top of the +2');
  });

  // ---------------------------------------------------------------
  // S7 — Random unlock (lands automatically with S6 certify)
  // ---------------------------------------------------------------
  describe('S7 — Random unlock', () => {
    it.todo('A: saved-for-you.unlocked-tile count goes 0 → 1 after partner cert');
    it.todo(
      'B: saved-for-you.unlocked-tile count goes 0 → 1 after partner cert (their saved-for-me side)',
    );
    it.todo(
      'B: saved-for-you.open-unlocked → screen.unlocked-saved-list → unlocked-saved-list.row.<savedPostId> visible',
    );
    it.todo(
      'B: tapping a second concurrent cert does NOT unlock a second post — same row stays the only one',
    );
  });

  // ---------------------------------------------------------------
  // S8 — Loop close: try it → rate → gratitude → +25
  // ---------------------------------------------------------------
  describe('S8 — Try it + rate + gratitude + Couple Points', () => {
    it.todo(
      'B: unlocked-saved-list.row.<id> → screen.unlocked-post-detail → unlocked-post-detail.body visible',
    );
    it.todo('B: unlocked-post-detail.tried-it → screen.gratitude (B is the enactor)');
    it.todo(
      'A: feed.open-saved → saved-for-you.open-unlocked → unlocked-saved-list.row.<id> → unlocked-post-detail.continue-loop → screen.rating-flow (A is the curator)',
    );
    it.todo('A: rating-flow.chip.9 → rating-flow.submit → navigates to screen.gratitude');
    it.todo('B: gratitude.mark-done → gratitude.mine-done visible');
    it.todo('A: gratitude.mark-done → gratitude.both-done + gratitude.loop-awarded visible');
    it.todo('B: gratitude.loop-awarded visible after the next sync cycle');
    it.todo('A & B: couple-home.points-tile shows +25 (POINTS_LOOP_COMPLETED) → total 2+10+25=37');
    it.todo(
      'PRIVACY: while rating-flow is visible, RatingFlow.body text never appears on the wire (operator-verified via relay-server logs)',
    );
  });

  // ---------------------------------------------------------------
  // Final acceptance
  // ---------------------------------------------------------------
  describe('Final — happy-path verified end-to-end', () => {
    it.todo('A: couple-home.points-tile text reads "37"');
    it.todo('B: couple-home.points-tile text reads "37"');
    it.todo('A: couple-home.row.<*> shows three ledger entries (save / cert / loop)');
    it.todo('B: same three ledger entries with matching ids (deterministic UUIDs)');
  });
});
