import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { listSavedByMe, type SavedPostRow } from '../../features/couple-channel/saved-post-store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SavedByYou } from './SavedByYou';

/**
 * Production wiring for SavedByYou. Reads the local saved_post table
 * filtered to rows this device created, refreshes via pull-down or on
 * focus. Tapping a row navigates to PostDetail; the "For you" link at
 * the top right hops over to the SavedForYou screen.
 */
export function SavedByYouRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [rows, setRows] = useState<SavedPostRow[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setRows([]);
      return;
    }
    setIsRefreshing(true);
    try {
      setRows(await listSavedByMe(exec, engine.selfPub));
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SavedByYou
      items={
        rows == null
          ? []
          : rows.map((r) => ({
              savedPostId: r.id,
              globalPostId: r.globalPostId,
              createdAt: r.createdAt,
              unlockedAt: r.unlockedAt,
            }))
      }
      isLoading={rows == null}
      isRefreshing={isRefreshing}
      onRefresh={() => void refresh()}
      onBack={() => navigation.goBack()}
      onSelect={(globalPostId) => navigation.navigate('PostDetail', { id: globalPostId })}
      onViewSavedForYou={() => navigation.navigate('SavedForYou')}
    />
  );
}
