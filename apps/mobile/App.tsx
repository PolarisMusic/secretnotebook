import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { runBoot } from './src/features/boot/run';
import { useBootStore } from './src/features/boot/store';
import { RootStack } from './src/navigation/RootStack';
import { queryClient } from './src/query/client';
import { BootScreen } from './src/screens/boot/BootScreen';

export function App(): JSX.Element {
  const phase = useBootStore((s) => s.phase);

  useEffect(() => {
    void runBoot();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
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
