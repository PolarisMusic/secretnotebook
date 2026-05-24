import { describe, expect, it, jest } from '@jest/globals';

import { applySecureScreen } from '../src/security/secure-screen-policy';

describe('applySecureScreen', () => {
  it('calls the bridge with the requested value on Android', () => {
    const setFlagSecure = jest.fn();
    expect(applySecureScreen(true, { platform: 'android', setFlagSecure })).toBe('applied');
    expect(setFlagSecure).toHaveBeenCalledTimes(1);
    expect(setFlagSecure).toHaveBeenCalledWith(true);
  });

  it('forwards both directions of the toggle', () => {
    const setFlagSecure = jest.fn();
    applySecureScreen(true, { platform: 'android', setFlagSecure });
    applySecureScreen(false, { platform: 'android', setFlagSecure });
    expect(setFlagSecure.mock.calls).toEqual([[true], [false]]);
  });

  it('no-ops on iOS — the OS handles recents-thumbnail blurring', () => {
    const setFlagSecure = jest.fn();
    expect(applySecureScreen(true, { platform: 'ios', setFlagSecure })).toBe('noop:non-android');
    expect(setFlagSecure).not.toHaveBeenCalled();
  });

  it('no-ops when the native bridge is missing — keeps dev / Expo Go / Jest happy', () => {
    expect(applySecureScreen(true, { platform: 'android', setFlagSecure: null })).toBe(
      'noop:no-module',
    );
  });

  it('returns the same outcome for unknown platforms', () => {
    const setFlagSecure = jest.fn();
    expect(applySecureScreen(true, { platform: 'web', setFlagSecure })).toBe('noop:non-android');
    expect(applySecureScreen(true, { platform: 'macos', setFlagSecure })).toBe('noop:non-android');
    expect(setFlagSecure).not.toHaveBeenCalled();
  });
});
