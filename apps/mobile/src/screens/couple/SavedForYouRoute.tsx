import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import {
  summariseSavedForMe,
  type SavedForMeSummary,
} from '../../features/couple-channel/saved-post-store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SavedForYou } from './SavedForYou';

/**
 * Production wiring for SavedForYou. Reads only counts — bodies stay
 * hidden until S7 unlocks them via a certified prompt. Pull-to-refresh
 * also triggers a sync pull so the partner's latest enqueue lands
 * quickly without waiting for the foreground polling timer.
 */
export function SavedForYouRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [summary, setSummary] = useState<SavedForMeSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setSummary({ total: 0, locked: 0, unlocked: 0 });
      return;
    }
    setIsRefreshing(true);
    try {
      // Best-effort pull to surface the partner's freshest envelopes.
      // Failures are non-fatal: the screen still renders whatever rows
      // already landed.
      try {
        await engine.pull();
      } catch {
        // ignore
      }
      setSummary(await summariseSavedForMe(exec, engine.selfPub));
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = summary ?? { total: 0, locked: 0, unlocked: 0 };
  return (
    <SavedForYou
      total={view.total}
      locked={view.locked}
      unlocked={view.unlocked}
      isRefreshing={isRefreshing}
      onRefresh={() => void refresh()}
      onBack={() => navigation.goBack()}
      onViewSavedByYou={() => navigation.navigate('SavedByYou')}
      onOpenUnlockedList={
        view.unlocked > 0 ? () => navigation.navigate('UnlockedSavedList') : undefined
      }
    />
  );
}
