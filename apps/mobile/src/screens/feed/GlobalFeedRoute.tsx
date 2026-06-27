import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { listHiddenPostIds } from '../../features/api/cache';
import { useApiStore } from '../../features/api/store';
import { useFlagPost, useHidePost, usePostsFeed, useUnhidePost } from '../../features/api/queries';
import { FlagSheet } from '../../features/feed/FlagSheet';
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
  const unhideMut = useUnhidePost({ exec });
  const flagMut = useFlagPost({ client: feedHooks.client! });

  // Locally-hidden set. Re-read on focus so a hide/unhide from the detail
  // screen reflects when the user returns. Routed through state (not the
  // query layer) so a hide doesn't refetch the feed page.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const refreshHidden = useCallback(async () => {
    if (!exec) {
      setHiddenIds(new Set());
      return;
    }
    setHiddenIds(await listHiddenPostIds(exec));
  }, [exec]);
  useFocusEffect(
    useCallback(() => {
      void refreshHidden();
    }, [refreshHidden]),
  );

  const onHidePost = useCallback(
    async (id: string) => {
      await hideMut.mutateAsync(id);
      await refreshHidden();
    },
    [hideMut, refreshHidden],
  );
  const onUnhidePost = useCallback(
    async (id: string) => {
      await unhideMut.mutateAsync(id);
      await refreshHidden();
    },
    [unhideMut, refreshHidden],
  );
  const [flagTargetId, setFlagTargetId] = useState<string | null>(null);
  const onFlagPost = useCallback((id: string) => setFlagTargetId(id), []);
  const onFlagSubmit = useCallback(
    (
      category: Parameters<typeof flagMut.mutateAsync>[0]['category'],
      detail: string | undefined,
    ) => {
      if (!flagTargetId) return Promise.resolve();
      return flagMut.mutateAsync({
        id: flagTargetId,
        category,
        ...(detail !== undefined ? { detail } : {}),
      });
    },
    [flagMut, flagTargetId],
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
        onHidePost={(id) => void onHidePost(id)}
        onUnhidePost={(id) => void onUnhidePost(id)}
        onFlagPost={onFlagPost}
        hiddenLocallyIds={hiddenIds}
        roleFilter={roleFilter}
        onSetFilter={setFilterOn}
      />
      <FlagSheet
        visible={flagTargetId != null}
        onClose={() => setFlagTargetId(null)}
        onSubmit={onFlagSubmit}
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
