import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { useSubmitPost } from '../../features/api/queries';
import { EntitlementError, requireCurrentEntitlement } from '../../features/iap/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SubmitPost } from './SubmitPost';

/**
 * Production wiring for SubmitPost. Runs the request via TanStack
 * Mutation so retries / inflight state are exposed for free. Returns
 * an error string from `onSubmit` so SubmitPost can render it inline;
 * on success, pops back to the feed (the mutation has already
 * invalidated the posts list so the new row appears on next reactive
 * render).
 *
 * R5 paywall: publishing to the global feed is the gated action.
 * Before firing the mutation, the route consults
 * `requireCurrentEntitlement(exec)` and surfaces a paywall-shaped
 * error string on EntitlementError. Without this gate the R5
 * promise would be unwired — the IAP entitlement table would be
 * checked nowhere on the production publish path.
 */
export function SubmitPostRoute(): JSX.Element {
  const client = useApiStore((s) => s.client);
  const exec = useDatabaseStore((s) => s.exec);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const mutation = useSubmitPost({ client: client! });

  if (!client || !exec) {
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
          // Gate first — no network call, no local state change,
          // no row materialised if the gate refuses.
          await requireCurrentEntitlement(exec, () => new Date());
          await mutation.mutateAsync(input);
          navigation.goBack();
          return null;
        } catch (e) {
          if (e instanceof EntitlementError) {
            return e.code === 'expired'
              ? 'Your subscription has lapsed. Renew to publish.'
              : 'Subscribe to publish.';
          }
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
