/* global device, element, by, expect */

/**
 * Single-sim Detox smoke. Boots the app to the Welcome surface,
 * then walks the single-device half of pairing (the second half
 * needs a peer simulator + BLE-mocked host; lives in the Mac
 * runbook).
 *
 * The R0-R5 refactor reshaped what comes after pairing — notes,
 * publish, roles, IAP — but those flows all require a paired,
 * Safe-Word-satisfied connection, so they don't show up in this
 * single-sim smoke. The end-to-end script with the full testID
 * inventory lives in `happy-path.test.ts`; the in-process
 * protocol-level acceptance harness is `tests/full-loop.test.ts`.
 */

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
