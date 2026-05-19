import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootStack } from './src/navigation/RootStack';
import { queryClient } from './src/query/client';

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <RootStack />
        </NavigationContainer>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
