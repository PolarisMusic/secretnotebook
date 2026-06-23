import { useEffect, useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { bytesToHex } from '@secretnotebook/crypto';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { runBoot } from './src/features/boot/run';
import { useBootStore } from './src/features/boot/store';
import { wipeAttachmentDirs } from './src/features/attachments/native';
import { useSyncEngineStore } from './src/features/connection-channel/store';
import { useSyncTicker, type SyncStep } from './src/features/connection-channel/ticker';
import { getSeverState, maybeFinalizeSever } from './src/features/connection/sever';
import { reconcileUnlockRewards } from './src/features/secret-unlock/store';
import { useConnectionStore } from './src/state/connection';
import { RootStack } from './src/navigation/RootStack';
import { queryClient } from './src/query/client';
import { BootScreen } from './src/screens/boot/BootScreen';

/**
 * Sub-component that subscribes to the sync engine and ticks. Kept
 * inside the QueryClientProvider tree but outside the NavigationContainer
 * so the timer survives any navigator-level remounts. No-ops while the
 * engine is null (unpaired devices).
 */
function SyncTicker(): null {
  const engine = useSyncEngineStore((s) => s.engine);
  const setEngine = useSyncEngineStore((s) => s.setEngine);
  // After each pull: (1) reconcile R7 unlock-loop Couple-Points awards (the
  // projector can't enqueue), and (2) finish a due R8 sever — or surface
  // the pending grace state for the banner. Memoised on the engine so the
  // ticker effect isn't torn down every render.
  const afterPull = useMemo(
    () =>
      engine
        ? async (): Promise<void> => {
            await reconcileUnlockRewards({
              exec: engine.exec,
              selfPubkey: engine.selfPub,
              enqueue: (op) => engine.enqueue(op),
            });
            const wiped = await maybeFinalizeSever({
              exec: engine.exec,
              deleteAttachmentFiles: wipeAttachmentDirs,
            });
            if (wiped) {
              useConnectionStore.getState().resetToUnpaired();
              setEngine(null);
            } else {
              const sever = await getSeverState(engine.exec);
              useConnectionStore
                .getState()
                .setSever(
                  sever?.severAt ?? null,
                  sever?.initiatedBy ? bytesToHex(sever.initiatedBy) : null,
                );
            }
          }
        : undefined,
    [engine, setEngine],
  );
  useSyncTicker(engine, { afterPull, onError: logSyncError });
  return null;
}

/**
 * Cycle-level error sink. flush()/pull() throws were previously dropped (no
 * onError was passed), so a failing relay call — e.g. a 500 from the
 * server — left no trace while "notes don't transfer". Module-level so its
 * identity is stable and doesn't retrigger the ticker effect.
 */
function logSyncError(err: Error, step: SyncStep): void {
  console.warn(`[sync] cycle error in ${step}: ${err.message}`);
}

export function App(): JSX.Element {
  const phase = useBootStore((s) => s.phase);

  useEffect(() => {
    void runBoot();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SyncTicker />
        {phase === 'ready' ? (
          <NavigationContainer>
            <RootStack />
          </NavigationContainer>
        ) : (
          <BootScreen onRetry={() => void runBoot()} />
        )}
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
