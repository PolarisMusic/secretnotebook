import { getSodium } from '@secretnotebook/crypto';
import { Platform } from 'react-native';

import { openDatabase } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { MIGRATIONS } from '../../db/migrations';
import { useDatabaseStore } from '../../db/store';
import { createKeychainAdapter } from '../../security/keychain';
import { useConnectionStore } from '../../state/connection';
import { ApiClient } from '../api/client';
import { DEFAULT_API_CONFIG } from '../api/config';
import { useApiStore } from '../api/store';
import { tryBuildSyncEngine } from '../connection-channel/build-engine';
import { useSyncEngineStore } from '../connection-channel/store';
import { DEV_GRANT_ENTITLEMENT } from '../iap/config';
import { devGrantBridge, devGrantValidator, productionValidator } from '../iap/dev-grant';
import { restoreEntitlementOnBoot } from '../iap/restore';
import { bootstrap, type BootDeps } from './bootstrap';
import { useBootStore } from './store';

const DB_FILENAME = 'secretnotebook.db';

/**
 * Production wrapper for `bootstrap`. Wires real native dependencies
 * (react-native-keychain, op-sqlite, libsodium random) and populates the
 * mobile-app Zustand stores from the result.
 *
 * Idempotent: a second call after `error` clears state and retries.
 *
 * Caller is expected to render <BootScreen /> while phase is `idle`,
 * `running`, or `error`; once `ready` the navigator can mount.
 */
export async function runBoot(): Promise<void> {
  const boot = useBootStore.getState();
  boot.start();
  try {
    const result = await bootstrap(defaultDeps());
    useDatabaseStore.getState().setExec(result.executor);
    if (result.connection) {
      useConnectionStore.setState({
        status: result.connection.status,
        connectionId: result.connection.connectionId,
      });
    }
    const apiClient = new ApiClient({
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
      keyPair: result.deviceSigningKey,
    });
    useApiStore.getState().setClient(apiClient);

    // If the device is already paired and the connection_ratchet row exists
    // from a prior session, lift the SyncEngine into the store now so
    // S5 routes don't have to wait for the next post-pairing event.
    // Unpaired devices boot with engine=null; pairing wires it in.
    if (result.connection && result.connection.status === 'paired') {
      const engine = await tryBuildSyncEngine({
        exec: result.executor,
        api: apiClient,
        connectionId: result.connection.connectionId,
      });
      useSyncEngineStore.getState().setEngine(engine);
    }

    // R5 publish gate restore. Two paths:
    //
    //   - DEV_GRANT_ENTITLEMENT=1 (tester builds): the dev-grant
    //     bridge hands the validator a known sentinel which is
    //     accepted unconditionally and cached for a year. Lets
    //     internal testers exercise the publish path without a
    //     sandbox IAP purchase.
    //   - default (production / external testers): no bridge is
    //     installed; restoreEntitlementOnBoot returns
    //     `reason: 'no-bridge'`, the entitlement cache stays empty,
    //     and the publish gate refuses with `no-entitlement` until
    //     the real react-native-iap pipeline lands. The
    //     productionValidator() seam is wired so any boot-side
    //     call goes through a single throw point — easy to swap
    //     when the real verify-receipt server is in place.
    const platform: 'ios' | 'android' = Platform.OS === 'android' ? 'android' : 'ios';
    await restoreEntitlementOnBoot({
      exec: result.executor,
      validator: DEV_GRANT_ENTITLEMENT ? devGrantValidator() : productionValidator(),
      bridge: DEV_GRANT_ENTITLEMENT ? devGrantBridge(platform) : null,
    });

    boot.succeed();
  } catch (e) {
    boot.fail((e as Error).message ?? 'Boot failed');
  }
}

function defaultDeps(): BootDeps {
  return {
    keychain: createKeychainAdapter(),
    randomBytes: async (n) => (await getSodium()).randombytes_buf(n),
    openDatabase: async (encryptionKey) => {
      const handle = await openDatabase({ name: DB_FILENAME, encryptionKey });
      return { executor: handle.executor };
    },
    runMigrations: (exec) => runMigrations(exec, MIGRATIONS).then(() => undefined),
  };
}
