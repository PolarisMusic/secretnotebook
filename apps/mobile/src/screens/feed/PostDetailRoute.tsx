import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { isPostHidden } from '../../features/api/cache';
import { useApiStore } from '../../features/api/store';
import { useFlagPost, useHidePost, usePostDetail, useUnhidePost } from '../../features/api/queries';
import {
  findSavedFor,
  removeSavedPost,
  saveGlobalPost,
  type SavedPostStoreDeps,
} from '../../features/connection-channel/saved-post-store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { promptForFlag } from '../../features/feed/flag-prompt';
import type { MainStackParamList } from '../../navigation/MainStack';
import { PostDetail } from './PostDetail';

/**
 * Production wiring for PostDetail. Reads `id` from the navigation
 * route, queries the API (write-throughs into `post_cache`), and renders
 * the screen.
 */
export function PostDetailRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'PostDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const client = useApiStore((s) => s.client);
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);

  const query = usePostDetail({
    client: client!,
    exec,
    id: route.params.id,
    enabled: client != null,
  });
  const hideMut = useHidePost({ exec });
  const unhideMut = useUnhidePost({ exec });
  const flagMut = useFlagPost({ client: client! });

  // Whether THIS post is locally hidden, so PostDetail can collapse it +
  // surface "Unhide". Refreshed on focus so a hide done elsewhere reflects.
  const [hiddenLocally, setHiddenLocally] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!exec) return;
      let cancelled = false;
      void isPostHidden(exec, route.params.id).then((h) => {
        if (!cancelled) setHiddenLocally(h);
      });
      return () => {
        cancelled = true;
      };
    }, [exec, route.params.id]),
  );

  const onHide = useCallback(
    async (id: string) => {
      await hideMut.mutateAsync(id);
      setHiddenLocally(true);
      // Stay on screen so the collapsed state + Show anyway are reachable
      // without bouncing back to the feed.
    },
    [hideMut],
  );
  const onUnhide = useCallback(
    async (id: string) => {
      await unhideMut.mutateAsync(id);
      setHiddenLocally(false);
    },
    [unhideMut],
  );
  const onFlag = useCallback(
    (_id: string) => {
      void promptForFlag((category, detail) =>
        flagMut.mutateAsync({
          id: route.params.id,
          category,
          ...(detail !== undefined ? { detail } : {}),
        }),
      );
    },
    [flagMut, route.params.id],
  );

  // Saved-post bookmark state. Reads on focus so a save/unsave done from
  // the SavedByYou screen reflects when the user returns here.
  const [savedRowId, setSavedRowId] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!exec || !engine) return;
      let cancelled = false;
      void findSavedFor(exec, engine.selfPub, route.params.id).then((row) => {
        if (!cancelled) setSavedRowId(row?.id ?? null);
      });
      return () => {
        cancelled = true;
      };
    }, [exec, engine, route.params.id]),
  );

  const savedDeps = useCallback((): SavedPostStoreDeps | null => {
    if (!exec || !engine) return null;
    return {
      exec,
      selfPubkey: engine.selfPub,
      enqueue: (op) => engine.enqueue(op),
    };
  }, [exec, engine]);

  const onSave = useCallback(
    (id: string) => {
      const deps = savedDeps();
      if (!deps) return;
      void (async () => {
        try {
          const row = await saveGlobalPost(deps, id);
          setSavedRowId(row.id);
        } catch (e) {
          Alert.alert('Could not save', (e as Error).message);
        }
      })();
    },
    [savedDeps],
  );

  const onUnsave = useCallback(() => {
    if (!exec || !savedRowId) return;
    void (async () => {
      try {
        await removeSavedPost(exec, savedRowId);
        setSavedRowId(null);
      } catch (e) {
        Alert.alert('Could not remove from saved', (e as Error).message);
      }
    })();
  }, [exec, savedRowId]);

  if (!client) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.post-detail.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Preparing your signed session…</Text>
      </SafeAreaView>
    );
  }

  return (
    <PostDetail
      post={query.data ?? null}
      isLoading={query.isLoading}
      error={query.error}
      onBack={() => navigation.goBack()}
      onHide={(id) => void onHide(id)}
      onUnhide={(id) => void onUnhide(id)}
      onFlag={onFlag}
      onSave={engine ? onSave : undefined}
      onUnsave={engine ? onUnsave : undefined}
      alreadySaved={savedRowId != null}
      hiddenLocally={hiddenLocally}
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
