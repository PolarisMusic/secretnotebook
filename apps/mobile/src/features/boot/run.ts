import { bytesToHex, getSodium } from '@secretnotebook/crypto';
import { Platform } from 'react-native';

import { openDatabase } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { hydrateCacheFromDb, replacePromptCache } from '../secret-unlock/prompt-cache';
import { MIGRATIONS } from '../../db/migrations';
import { useDatabaseStore } from '../../db/store';
import { createKeychainAdapter } from '../../security/keychain';
import { useConnectionStore } from '../../state/connection';
import { ApiClient } from '../api/client';
import { DEFAULT_API_CONFIG } from '../api/config';
import { useApiStore } from '../api/store';
import { wipeAttachmentDirs } from '../attachments/native';
import { tryBuildSyncEngine } from '../connection-channel/build-engine';
import { useSyncEngineStore } from '../connection-channel/store';
import { getSeverState, maybeFinalizeSever } from '../connection/sever';
import { DEV_GRANT_ENTITLEMENT } from '../iap/config';
import { devGrantBridge, devGrantValidator, productionValidator } from '../iap/dev-grant';
import { restoreEntitlementOnBoot } from '../iap/restore';
import { bootstrap, type BootDeps } from './bootstrap';
import { loadConnectionRootKey } from './connection-load';
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

    const apiClient = new ApiClient({
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
      keyPair: result.deviceSigningKey,
    });
    // Surface the resolved API host once per boot. The relay (partner-note
    // transport) lives behind this URL, so two paired phones that resolve
    // DIFFERENT base URLs — e.g. one TestFlight build on the Fly default and
    // one Metro build with EXPO_PUBLIC_API_BASE_URL pointed at a LAN/localhost
    // dev server — will post and poll on separate servers and never exchange
    // notes, even though each phone looks healthy on its own. Comparing this
    // line across both devices rules that split in or out at a glance.
    console.log(`[api] base=${DEFAULT_API_CONFIG.baseUrl}`);
    useApiStore.getState().setClient(apiClient);

    if (result.connection) {
      const { status, connectionId } = result.connection;
      // R8: if a pending sever has come due while the app was closed,
      // finish the wipe now — the device falls back to unpaired before the
      // navigator mounts. Otherwise surface the connection + any pending
      // sever so the grace banner can render its countdown.
      const wiped = await maybeFinalizeSever({
        exec: result.executor,
        deleteAttachmentFiles: wipeAttachmentDirs,
      });
      if (wiped) {
        useConnectionStore.getState().resetToUnpaired();
        useSyncEngineStore.getState().setEngine(null);
      } else {
        useConnectionStore.setState({ status, connectionId });
        const sever = await getSeverState(result.executor);
        useConnectionStore
          .getState()
          .setSever(
            sever?.severAt ?? null,
            sever?.initiatedBy ? bytesToHex(sever.initiatedBy) : null,
          );
        // Re-hydrate the pending root_key on a cold launch that boots
        // straight into 'awaiting_safeword'. The live pairing flow sets this
        // in memory; a restart before the Safe Word is defined would
        // otherwise lose it and strand the user on DefineSafeWord.
        if (status === 'awaiting_safeword') {
          const pendingRootKey = await loadConnectionRootKey(result.executor, connectionId);
          if (pendingRootKey) {
            useConnectionStore.setState({ pendingRootKey });
          }
        }
        // If already paired and connection_ratchet exists from a prior
        // session, lift the SyncEngine now so routes don't wait for the
        // next post-pairing event. Unpaired devices boot with engine=null.
        if (status === 'paired') {
          const engine = await tryBuildSyncEngine({
            exec: result.executor,
            api: apiClient,
            connectionId,
          });
          useSyncEngineStore.getState().setEngine(engine);
        }
      }
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

    // Prompt-library cache: hydrate from SQLite synchronously so the unlock
    // screens have something to draw from before the network round-trip,
    // then kick off a best-effort refresh in the background. A failure
    // here (server down, network off) is silent — the bundled list keeps
    // working.
    try {
      await hydrateCacheFromDb(result.executor);
    } catch (e) {
      console.warn('[prompts] hydrate failed', (e as Error).message);
    }
    void (async () => {
      try {
        const fresh = await apiClient.fetchPrompts();
        const fetchedAtSec =
          Math.floor(Date.parse(fresh.fetchedAt) / 1000) || Math.floor(Date.now() / 1000);
        await replacePromptCache(result.executor, fresh.items, fetchedAtSec);
      } catch (e) {
        console.warn('[prompts] sync failed', (e as Error).message);
      }
    })();

    boot.succeed();
  } catch (e) {
    const msg = (e as Error).message ?? 'Boot failed';
    boot.fail(msg);
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
