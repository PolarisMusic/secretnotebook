import * as Keychain from 'react-native-keychain';

import { bytesToHex, hexToBytes } from '@secretnotebook/crypto';

/**
 * Adapter over the platform keychain so business logic doesn't import
 * react-native-keychain directly (and so we can mock the keychain in
 * Node unit tests).
 */
export interface KeychainAdapter {
  hasDeviceMaster(): Promise<boolean>;
  saveDeviceMaster(master: Uint8Array): Promise<void>;
  loadDeviceMaster(): Promise<Uint8Array | null>;
  clearDeviceMaster(): Promise<void>;
}

const SERVICE = 'com.secretnotebook.device_master';
const USERNAME = 'device_master';

/**
 * Preferred storage: seal the device_master behind biometric OR device
 * passcode so reading it requires fresh user presence (defence-in-depth for
 * the at-rest DB key even on an unlocked/forensically-imaged device). Used
 * whenever the device can satisfy the access control — Face/Touch ID
 * enrolled, or a device passcode set.
 */
const biometricSetOptions: Keychain.SetOptions = {
  service: SERVICE,
  accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
};

/**
 * Fallback storage for devices that can't satisfy the biometric/passcode
 * access control — i.e. no enrolled biometric AND no device passcode. Without
 * it, `setGenericPassword` rejects with `errSecAuthFailed` ("The user name or
 * passphrase you entered is not correct") and the app is completely unbootable
 * on such devices (the boot pipeline reads device_master before any UI).
 *
 * The item is still THIS_DEVICE_ONLY — never synced to iCloud, never in
 * backups — and only readable while the device is unlocked; it just isn't
 * gated by a per-read biometric prompt. The app-level AppLockGate remains the
 * privacy gate, and it already degrades gracefully when biometrics aren't
 * available.
 */
const fallbackSetOptions: Keychain.SetOptions = {
  service: SERVICE,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
};

/**
 * Read options. The access control lives on the stored item (set at write
 * time), so it isn't repeated here; `authenticationPrompt` only surfaces when
 * the item actually requires user presence (biometric-sealed items) and is a
 * no-op for a fallback item.
 */
const getOptions: Keychain.GetOptions = {
  service: SERVICE,
  authenticationPrompt: {
    title: 'Unlock your connection notebook',
    cancel: 'Cancel',
  },
};

/**
 * Default RN implementation. The master is stored hex-encoded under a
 * dedicated service so it cannot collide with any other secret. iOS seals it
 * behind biometry-or-passcode where possible (falling back to device-unlock
 * storage otherwise); Android uses the strongest available class (StrongBox if
 * present, then TEE). `getGenericPassword` triggers the OS biometric prompt on
 * retrieval of a sealed item.
 */
export function createKeychainAdapter(): KeychainAdapter {
  return {
    async hasDeviceMaster() {
      return Boolean(await Keychain.hasGenericPassword({ service: SERVICE }));
    },
    async saveDeviceMaster(master) {
      if (master.length !== 32) throw new Error('device_master must be 32 bytes');
      const hex = bytesToHex(master);
      try {
        await Keychain.setGenericPassword(USERNAME, hex, biometricSetOptions);
      } catch (e) {
        // The device can't satisfy the biometric/passcode access control (no
        // enrolled biometric and no device passcode). Store with device-unlock
        // protection instead so the app remains usable; the AppLockGate stays
        // the privacy gate. Without this, the app is unbootable on such
        // devices.
        console.warn(
          '[keychain] biometric-sealed device_master store failed; falling back ' +
            'to device-unlock storage:',
          (e as Error).message,
        );
        await Keychain.setGenericPassword(USERNAME, hex, fallbackSetOptions);
      }
    },
    async loadDeviceMaster() {
      try {
        const creds = await Keychain.getGenericPassword(getOptions);
        if (!creds) return null;
        return hexToBytes(creds.password);
      } catch (e) {
        // A read can fail for two very different reasons:
        //   (a) nothing is stored yet — return null so the caller creates a
        //       fresh master (this is the path on a no-biometric device whose
        //       first biometric write never landed);
        //   (b) an item exists but this device can no longer satisfy its
        //       access control, or the user cancelled the prompt — surface the
        //       error rather than returning null, which would orphan the
        //       already-encrypted database behind a newly-generated key.
        const exists = Boolean(await Keychain.hasGenericPassword({ service: SERVICE }));
        if (!exists) return null;
        throw e;
      }
    },
    async clearDeviceMaster() {
      await Keychain.resetGenericPassword({ service: SERVICE });
    },
  };
}
