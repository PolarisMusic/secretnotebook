import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { tryBuildSyncEngine } from '../../features/connection-channel/build-engine';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { deriveConnectionSafeWord, saveSafeWord } from '../../features/safeword/verifier';
import { useSafeWordSession } from '../../features/safeword/session';
import { useConnectionStore } from '../../state/connection';
import { DefineSafeWord } from './DefineSafeWord';

/**
 * Production wiring for DefineSafeWord. Reads the pending root_key and
 * connectionId from the connection store (set by the pairing flow), derives the
 * Argon2id material, writes the row via the database store's executor,
 * advances connection.status to 'paired', satisfies the Safe Word session
 * so the user is not immediately prompted by the gate, and lifts the
 * SyncEngine into useSyncEngineStore — the first moment all of the
 * engine's prerequisites (paired connection + connection_ratchet + ApiClient)
 * are simultaneously satisfied.
 */
export function DefineSafeWordRoute(): JSX.Element {
  const exec = useDatabaseStore((s) => s.exec);
  const apiClient = useApiStore((s) => s.client);
  const setEngine = useSyncEngineStore((s) => s.setEngine);
  const connectionId = useConnectionStore((s) => s.connectionId);
  const pendingRootKey = useConnectionStore((s) => s.pendingRootKey);
  const finalizePairing = useConnectionStore((s) => s.finalizePairing);
  const satisfySession = useSafeWordSession((s) => s.satisfy);

  return (
    <DefineSafeWord
      onSubmit={async (safeword) => {
        if (!exec) return 'Database is not ready yet — try again in a moment.';
        if (!connectionId || !pendingRootKey) {
          return 'Pairing state is missing — restart from the beginning.';
        }
        try {
          const material = await deriveConnectionSafeWord(pendingRootKey, safeword);
          await saveSafeWord(exec, connectionId, material);
          finalizePairing();
          satisfySession();
          if (apiClient) {
            const engine = await tryBuildSyncEngine({ exec, api: apiClient, connectionId });
            setEngine(engine);
          }
          return null;
        } catch (e) {
          return (e as Error).message ?? 'Could not save Safe Word';
        }
      }}
    />
  );
}
