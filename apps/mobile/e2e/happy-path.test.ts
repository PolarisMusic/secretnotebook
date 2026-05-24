/* global device, element, by, expect, waitFor */

/**
 * Phase-1.5 happy-path Detox spec. The old Phase-1 spec walked the
 * save → prompt → certify → unlock → rate → gratitude loop that R0
 * deleted; this rewrite walks the post-R5 surface:
 *
 *   pair (BLE mocked) → Safe Word → both submit a post on the global
 *   feed → write a shared note (R2) → partner sees it → write a
 *   secret note, reveal it (R2) → set my role on the connection
 *   (R4) → buy an IAP subscription → publish a note to the global
 *   feed (R3 + R5) → both sides see the published_* marker on the
 *   note row
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
 * The in-process two-device backbone for everything past pairing
 * lives in `apps/mobile/tests/full-loop.test.ts`; that's where to
 * look for the protocol-level acceptance assertions (notes round-
 * trip, body-not-on-wire invariant, publish propagation, IAP gate
 * fail-closed). This Detox spec is the UI verification layer on
 * top.
 */

describe('Phase-1.5 happy path — verification flow', () => {
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
  // S3 — Global feed + post submission (unchanged from Phase 1)
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
  // S4 — Notes (R2): shared + secret + reveal
  // ---------------------------------------------------------------
  describe('S4 — Notes (R2)', () => {
    it.todo('A: notes.compose → notes.kind.shared + notes.body + notes.submit → notes.row.<id>');
    it.todo('B: notes.row.<id> body visible after the next sync cycle (shared = body on wire)');
    it.todo('A: notes.compose → notes.kind.secret + notes.body + notes.submit → notes.row.<id>');
    it.todo(
      'B: notes.row.<id> shows notes.body.locked (existence visible, body NULL until reveal)',
    );
    it.todo(
      'A: notes.row.<id> → notes-detail.reveal → after sync, B notes.row.<id> body becomes visible',
    );
    it.todo(
      'PRIVACY: while the secret note is in pre-reveal, the body never appears on the relay (operator-verified via relay logs; covered mechanically by tests/full-loop.test.ts secret-body-not-on-wire invariant)',
    );
  });

  // ---------------------------------------------------------------
  // S5 — Connection role (R4)
  // ---------------------------------------------------------------
  describe('S5 — Connection role (R4)', () => {
    it.todo(
      'A: connection-home.set-role → connection-home.role.masculine selected → connection-home.role.partner_a reads "masculine"',
    );
    it.todo('B: after sync, connection-home.role.partner_a reads "masculine"');
    it.todo(
      'B: connection-home.set-role → connection-home.role.feminine selected → connection-home.role.partner_b reads "feminine"',
    );
    it.todo(
      'A: after sync, connection-home.role.partner_b reads "feminine" (both sides converge on the same snapshot)',
    );
    it.todo('A: change role to neutral → B converges on neutral after sync (last-write-wins)');
  });

  // ---------------------------------------------------------------
  // S6 — Publish to the global feed (R3) + IAP gate (R5)
  // ---------------------------------------------------------------
  describe('S6 — Publish + IAP gate', () => {
    it.todo(
      'A (no entitlement): notes.row.<id> → notes-detail.publish → paywall.subscribe visible; tapping outside dismisses without publishing',
    );
    it.todo(
      'A: paywall.subscribe → triggers IAP sandbox flow → on success, entitlement cache populated (verify via debug-menu.iap.status)',
    );
    it.todo(
      'A: notes-detail.publish → server POST succeeds → notes-detail.published-badge with global_post_id link visible',
    );
    it.todo(
      'A: feed.refresh → the new feed.post.<global_post_id> row is at the top of the list with notes-content body',
    );
    it.todo(
      'B: after sync, notes-detail for the same note shows notes-detail.published-badge with the same global_post_id',
    );
    it.todo(
      'A (expired entitlement): notes.row.<unpublished-id> → notes-detail.publish → paywall.renew visible; existing published notes still show their badge',
    );
  });

  // ---------------------------------------------------------------
  // Final acceptance
  // ---------------------------------------------------------------
  describe('Final — Phase-1.5 happy-path verified end-to-end', () => {
    it.todo('A: notes.list shows shared + secret + published rows with the right badges');
    it.todo('B: same notes.list ordering + body availability matches A');
    it.todo(
      'A & B: connection-home.role.partner_a / .partner_b match across devices (R4 convergence)',
    );
    it.todo(
      'A & B: feed.post.<published_global_post_id> visible to both partners and to anyone else on the global feed',
    );
  });
});
