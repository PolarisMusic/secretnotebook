import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { listNotes, type NoteRow } from '../../features/notes/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { NotesList } from './NotesList';

/**
 * Production wiring for NotesList. Reads via `listNotes(exec)` and
 * also kicks the sync engine on pull-to-refresh so the partner's
 * latest ops surface without waiting for the 15s ticker.
 */
export function NotesListRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [items, setItems] = useState<NoteRow[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec) {
      setItems([]);
      return;
    }
    setIsRefreshing(true);
    try {
      if (engine) {
        try {
          await engine.pull();
        } catch {
          // best-effort
        }
      }
      const rows = await listNotes(exec);
      setItems(rows);
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <NotesList
      items={items ?? []}
      isLoading={items == null}
      isRefreshing={isRefreshing}
      onRefresh={() => void refresh()}
      onSelectNote={(id) => navigation.navigate('NotesDetail', { id })}
      onCompose={() => navigation.navigate('NotesCompose')}
      onBack={() => navigation.goBack()}
    />
  );
}
