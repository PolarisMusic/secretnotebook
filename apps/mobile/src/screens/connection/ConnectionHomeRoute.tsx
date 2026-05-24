import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { listRecentLedgerEntries, sumConnectionPoints } from '../../features/ledger/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { ConnectionHome } from './ConnectionHome';
import type { ActivityRow } from './ConnectionHome';

/**
 * Production wiring for ConnectionHome. Sums + lists from the local
 * ledger; pull-to-refresh also kicks the sync engine so the partner's
 * latest activity surfaces without waiting for the 15s ticker.
 */
export function ConnectionHomeRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [totalPoints, setTotalPoints] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setTotalPoints(0);
      setActivity([]);
      return;
    }
    setIsRefreshing(true);
    try {
      try {
        await engine.pull();
      } catch {
        // best-effort
      }
      const [sum, entries] = await Promise.all([
        sumConnectionPoints(exec),
        listRecentLedgerEntries(exec, 30),
      ]);
      setTotalPoints(sum);
      setActivity(
        entries.map((e) => ({
          id: e.id,
          delta: e.delta,
          reason: e.reason,
          createdAt: e.createdAt,
        })),
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ConnectionHome
      totalPoints={totalPoints ?? 0}
      activity={activity ?? []}
      isLoading={activity == null}
      isRefreshing={isRefreshing}
      onRefresh={() => void refresh()}
      onBack={() => navigation.goBack()}
      onOpenSaved={engine ? () => navigation.navigate('SavedByYou') : undefined}
    />
  );
}
