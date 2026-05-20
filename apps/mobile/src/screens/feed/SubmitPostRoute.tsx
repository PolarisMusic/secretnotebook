import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApiStore } from '../../features/api/store';
import { useSubmitPost } from '../../features/api/queries';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SubmitPost } from './SubmitPost';

/**
 * Production wiring for SubmitPost. Runs the request via TanStack
 * Mutation so retries / inflight state are exposed for free. Returns an
 * error string from `onSubmit` so SubmitPost can render it inline; on
 * success, pops back to the feed (the mutation has already invalidated
 * the posts list so the new row appears on next reactive render).
 */
export function SubmitPostRoute(): JSX.Element {
  const client = useApiStore((s) => s.client);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const mutation = useSubmitPost({ client: client! });

  if (!client) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.submit-post.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Preparing your signed session…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SubmitPost
      onCancel={() => navigation.goBack()}
      onSubmit={async (input) => {
        try {
          await mutation.mutateAsync(input);
          navigation.goBack();
          return null;
        } catch (e) {
          return (e as Error).message ?? 'Could not submit';
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  gateText: { color: '#9e9e9e', fontSize: 14 },
});
