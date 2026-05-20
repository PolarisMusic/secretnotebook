import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Thin adapter over expo-local-authentication so business logic does not
 * import the Expo module directly (mockable in Node tests and the screen
 * stays testable in isolation).
 */
export interface BiometricPrompt {
  /** True iff the device has hardware + at least one enrolled biometric. */
  isAvailable(): Promise<boolean>;
  /** Trigger the OS biometric prompt with our localised reason string. */
  authenticate(reason: string): Promise<BiometricResult>;
}

export type BiometricResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function createBiometricPrompt(): BiometricPrompt {
  return {
    async isAvailable() {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) return false;
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return enrolled;
    },
    async authenticate(reason) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
        fallbackLabel: 'Use passcode',
      });
      if (result.success) return { ok: true };
      return { ok: false, reason: result.error ?? 'cancelled' };
    },
  };
}
