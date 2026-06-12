// Disable native screens BEFORE any react-navigation code loads. The 4.x
// rewrite of react-native-screens has touch-handling regressions on
// iOS that surface as "every onPress is dead" even though scroll
// gestures work. Falling back to JS-only screen wrappers is the
// documented escape hatch.
//
// MUST stay before the @react-navigation imports below.
import { enableScreens } from 'react-native-screens';
enableScreens(false);

import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DebugOverlay } from './src/debug/DebugOverlay';
import { debugLog } from './src/debug/log-store';
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
    debugLog('app', 'mount (screens=disabled, RNGH=root)');
    void runBoot();
  }, []);

  useEffect(() => {
    debugLog('app', `phase=${phase}`);
  }, [phase]);

  return (
    // GestureHandlerRootView at the top lets react-native-gesture-handler
    // install its native gesture pipeline that bypasses RN's responder
    // system. WelcomeScreen has a RectButton variant that runs through
    // this pipeline.
    <GestureHandlerRootView style={{ flex: 1 }}>
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
          <DebugOverlay />
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
