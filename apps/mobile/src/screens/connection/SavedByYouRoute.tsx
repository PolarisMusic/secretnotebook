import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { getCachedPost } from '../../features/api/cache';
import {
  listSavedByMe,
  type SavedPostRow,
} from '../../features/connection-channel/saved-post-store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SavedByYou, type SavedByYouItem } from './SavedByYou';

/**
 * Production wiring for the Saved tab. Reads saved_post rows the local
 * device owns and joins them against the local post_cache for body previews.
 * Tapping a row navigates to PostDetail with the savedPostId so the full
 * suite of actions (view, add to notes, remove from saved) is available inline.
 */
export function SavedByYouRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [items, setItems] = useState<SavedByYouItem[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setItems([]);
      return;
    }
    setIsRefreshing(true);
    try {
      const rows: SavedPostRow[] = await listSavedByMe(exec, engine.selfPub);
      const next: SavedByYouItem[] = await Promise.all(
        rows.map(async (r) => {
          const cached = await getCachedPost(exec, r.globalPostId);
          return {
            savedPostId: r.id,
            globalPostId: r.globalPostId,
            createdAt: r.createdAt,
            bodyPreview: cached?.body ?? null,
          };
        }),
      );
      setItems(next);
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <SavedByYou
      items={items ?? []}
      isLoading={items == null}
      isRefreshing={isRefreshing}
      onRefresh={() => void refresh()}
      onBack={() => navigation.goBack()}
      onSelect={(item) =>
        navigation.navigate('PostDetail', { id: item.globalPostId, savedPostId: item.savedPostId })
      }
    />
  );
}
