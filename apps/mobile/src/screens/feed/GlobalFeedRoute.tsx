import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { usePostsFeed } from '../../features/api/queries';
import type { MainStackParamList } from '../../navigation/MainStack';
import { GlobalFeed } from './GlobalFeed';

/**
 * Production wiring for GlobalFeed. Builds the infinite-scroll query
 * against the ApiClient that boot already stashed on useApiStore, and
 * navigates to SubmitPost / PostDetail via the typed MainStack params.
 *
 * Until boot has populated useApiStore (e.g. during the brief window
 * between boot.succeed() and the next render), we render a small
 * placeholder so the navigator can mount immediately.
 */
export function GlobalFeedRoute(): JSX.Element {
  const client = useApiStore((s) => s.client);
  const exec = useDatabaseStore((s) => s.exec);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();

  const feedHooks = useMemo(
    () => ({ client, exec }) as { client: NonNullable<typeof client>; exec: typeof exec },
    [client, exec],
  );

  // Hooks must be called unconditionally; pass a sentinel when the client
  // isn't ready yet and gate the result below.
  const query = usePostsFeed({
    client: feedHooks.client!,
    exec: feedHooks.exec,
    pageSize: 20,
  });

  if (!client) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.global-feed.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Preparing your signed session…</Text>
      </SafeAreaView>
    );
  }

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={styles.container}>
      <GlobalFeed
        items={items}
        isRefreshing={query.isRefetching}
        hasNextPage={query.hasNextPage ?? false}
        isFetchingNextPage={query.isFetchingNextPage}
        error={query.error}
        onRefresh={() => void query.refetch()}
        onLoadMore={() => void query.fetchNextPage()}
        onSelectPost={(id) => navigation.navigate('PostDetail', { id })}
        onCompose={() => navigation.navigate('SubmitPost')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  gate: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  gateText: { color: '#9e9e9e', fontSize: 14 },
});
