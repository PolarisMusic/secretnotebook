import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { cachePost, getCachedPost } from '../../features/api/cache';
import { useApiStore } from '../../features/api/store';
import { listUnlockedForMe } from '../../features/couple-channel/saved-post-store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { UnlockedSavedList, type UnlockedItem } from './UnlockedSavedList';

const BODY_PREVIEW_LENGTH = 160;

/**
 * Production wiring for UnlockedSavedList. Loads the saved_post rows
 * unlocked for me, then resolves each row's body via post_cache (S3
 * write-through). Cache misses are filled in from the global posts API
 * — best effort; the row still renders with a "Fetching…" placeholder
 * if the network is down. Tapping a row hands off to PostDetail which
 * already handles the Safe Word gate via RootStack's session
 * dependency.
 */
export function UnlockedSavedListRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const apiClient = useApiStore((s) => s.client);
  const [items, setItems] = useState<UnlockedItem[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setItems([]);
      return;
    }
    setIsRefreshing(true);
    try {
      // Best-effort sync pull so freshly arriving unlocks land before
      // the list renders.
      try {
        await engine.pull();
      } catch {
        // ignore — list still renders from local state below
      }
      const rows = await listUnlockedForMe(exec, engine.selfPub);

      // Resolve each row's body from post_cache; on miss + online,
      // fetch from the API and write through. We do this serially to
      // keep the request volume low on first open.
      const resolved: UnlockedItem[] = [];
      for (const r of rows) {
        let body: string | null = null;
        const cached = await getCachedPost(exec, r.globalPostId);
        if (cached) {
          body = cached.body;
        } else if (apiClient) {
          try {
            const post = await apiClient.getPost(r.globalPostId);
            await cachePost(exec, post);
            body = post.body;
          } catch {
            // server-side 404 or transient — leave body=null
          }
        }
        const preview =
          body == null
            ? null
            : body.length > BODY_PREVIEW_LENGTH
              ? `${body.slice(0, BODY_PREVIEW_LENGTH).trim()}…`
              : body;
        resolved.push({
          savedPostId: r.id,
          globalPostId: r.globalPostId,
          bodyPreview: preview,
          unlockedAt: r.unlockedAt ?? 0,
        });
      }
      setItems(resolved);
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine, apiClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <UnlockedSavedList
      items={items ?? []}
      isLoading={items == null}
      isRefreshing={isRefreshing}
      onRefresh={() => void refresh()}
      onBack={() => navigation.goBack()}
      onSelect={(globalPostId) => {
        // Find the saved_post row that matches and route through the
        // S8 unlocked-post-detail (with "I tried it"). FlatList row
        // already carries the savedPostId; we look it up via items
        // here rather than re-querying since we already have it.
        const item = items?.find((r) => r.globalPostId === globalPostId);
        if (item) navigation.navigate('UnlockedPostDetail', { savedPostId: item.savedPostId });
      }}
    />
  );
}
