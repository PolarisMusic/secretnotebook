import { getSodium } from '@secretnotebook/crypto';

import { openDatabase } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { MIGRATIONS } from '../../db/migrations';
import { useDatabaseStore } from '../../db/store';
import { createKeychainAdapter } from '../../security/keychain';
import { useCoupleStore } from '../../state/couple';
import { ApiClient } from '../api/client';
import { DEFAULT_API_CONFIG } from '../api/config';
import { useApiStore } from '../api/store';
import { tryBuildSyncEngine } from '../couple-channel/build-engine';
import { useSyncEngineStore } from '../couple-channel/store';
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
    if (result.couple) {
      useCoupleStore.setState({
        status: result.couple.status,
        coupleId: result.couple.coupleId,
      });
    }
    const apiClient = new ApiClient({
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
      keyPair: result.deviceSigningKey,
    });
    useApiStore.getState().setClient(apiClient);

    // If the device is already paired and the couple_ratchet row exists
    // from a prior session, lift the SyncEngine into the store now so
    // S5 routes don't have to wait for the next post-pairing event.
    // Unpaired devices boot with engine=null; pairing wires it in.
    if (result.couple && result.couple.status === 'paired') {
      const engine = await tryBuildSyncEngine({
        exec: result.executor,
        api: apiClient,
        coupleId: result.couple.coupleId,
      });
      useSyncEngineStore.getState().setEngine(engine);
    }

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
