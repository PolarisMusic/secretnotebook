import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { runBoot } from './src/features/boot/run';
import { useBootStore } from './src/features/boot/store';
import { useSyncEngineStore } from './src/features/connection-channel/store';
import { useSyncTicker } from './src/features/connection-channel/ticker';
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
  useSyncTicker(engine);
  return null;
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
