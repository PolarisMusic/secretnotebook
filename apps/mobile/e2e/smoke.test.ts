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
