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
 * Default RN implementation. The master is stored hex-encoded under a
 * dedicated service so it cannot collide with any other secret. iOS uses
 * Keychain access control set to BIOMETRY_ANY_OR_DEVICE_PASSCODE; Android
 * uses the strongest available class (StrongBox if present, then TEE).
 * `getGenericPassword` triggers the OS biometric prompt on retrieval.
 */
export function createKeychainAdapter(): KeychainAdapter {
  const setOptions: Keychain.SetOptions = {
    service: SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
  };
  const getOptions: Keychain.GetOptions = {
    service: SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    authenticationPrompt: {
      title: 'Unlock your connection notebook',
      cancel: 'Cancel',
    },
  };

  return {
    async hasDeviceMaster() {
      return Boolean(await Keychain.hasGenericPassword({ service: SERVICE }));
    },
    async saveDeviceMaster(master) {
      if (master.length !== 32) throw new Error('device_master must be 32 bytes');
      await Keychain.setGenericPassword(USERNAME, bytesToHex(master), setOptions);
    },
    async loadDeviceMaster() {
      const creds = await Keychain.getGenericPassword(getOptions);
      if (!creds) return null;
      return hexToBytes(creds.password);
    },
    async clearDeviceMaster() {
      await Keychain.resetGenericPassword({ service: SERVICE });
    },
  };
}
