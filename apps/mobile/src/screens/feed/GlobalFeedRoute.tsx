import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PostFlagCategory } from '@secretnotebook/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { useFlagPost, useHidePost, usePostsFeed } from '../../features/api/queries';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { getMyRole, type ConnectionRole } from '../../features/connection/role-store';
import { effectiveAudience } from '../../features/feed/audience';
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
  const engine = useSyncEngineStore((s) => s.engine);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();

  // The viewer's connection role drives the default-on feed filter. Null when
  // unpaired/neutral — in which case no toggle is shown and the feed is unfiltered.
  const [myRole, setMyRole] = useState<ConnectionRole | null>(null);
  const [filterOn, setFilterOn] = useState(true);
  useEffect(() => {
    if (!exec || !engine) {
      setMyRole(null);
      return;
    }
    let cancelled = false;
    void getMyRole(exec, engine.selfPub).then((r) => {
      if (!cancelled) setMyRole(r);
    });
    return () => {
      cancelled = true;
    };
  }, [exec, engine]);

  const audience = effectiveAudience(myRole, filterOn);

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
    audience,
  });
  const hideMut = useHidePost({ exec });
  const flagMut = useFlagPost({ client: feedHooks.client! });

  const onHidePost = useCallback((id: string) => hideMut.mutate(id), [hideMut]);
  const onFlagPost = useCallback(
    (id: string) => {
      const choices: ReadonlyArray<{ label: string; category: PostFlagCategory }> = [
        { label: 'Sexual content', category: 'sexual' },
        { label: 'Violence', category: 'violent' },
        { label: 'Spam', category: 'spam' },
        { label: 'Other', category: 'other' },
      ];
      Alert.alert(
        'Flag this post',
        'Why are you reporting it? This hides the content for everyone.',
        [
          ...choices.map((c) => ({
            text: c.label,
            onPress: () => flagMut.mutate({ id, category: c.category }),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    },
    [flagMut],
  );

  if (!client) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.global-feed.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Preparing your signed session…</Text>
      </SafeAreaView>
    );
  }

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const roleFilter = myRole === 'masculine' || myRole === 'feminine' ? { on: filterOn } : null;

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
        onHidePost={onHidePost}
        onFlagPost={onFlagPost}
        roleFilter={roleFilter}
        onSetFilter={setFilterOn}
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
