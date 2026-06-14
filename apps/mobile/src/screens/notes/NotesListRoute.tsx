import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { listNotes, type NoteRow } from '../../features/notes/store';
import { getAppSetting, INTRO_SEEN_KEY, setAppSetting } from '../../features/settings/store';
import { useConnectionStore } from '../../state/connection';
import type { MainStackParamList } from '../../navigation/MainStack';
import { IntroOverlay } from '../onboarding/IntroOverlay';
import { NotesList } from './NotesList';

/**
 * Production wiring for the Notes home. Reads via `listNotes(exec)`, kicks
 * the sync engine to surface partner ops, and — via useFocusEffect — auto
 * refreshes whenever the screen regains focus (e.g. returning from the
 * compose modal), so a new note appears without a manual pull-to-refresh.
 */
export function NotesListRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const status = useConnectionStore((s) => s.status);
  const [items, setItems] = useState<NoteRow[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showIntro, setShowIntro] = useState(false);

  // One-time intro: show until the user dismisses it once.
  useEffect(() => {
    if (!exec) return;
    let cancelled = false;
    void getAppSetting(exec, INTRO_SEEN_KEY).then((seen) => {
      if (!cancelled && seen !== '1') setShowIntro(true);
    });
    return () => {
      cancelled = true;
    };
  }, [exec]);

  const dismissIntro = useCallback(() => {
    setShowIntro(false);
    if (exec) void setAppSetting(exec, INTRO_SEEN_KEY, '1');
  }, [exec]);

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

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <>
      <NotesList
        items={items ?? []}
        isLoading={items == null}
        isRefreshing={isRefreshing}
        paired={status === 'paired'}
        onRefresh={() => void refresh()}
        onSelectNote={(id) => navigation.navigate('NotesDetail', { id })}
        onCompose={() => navigation.navigate('NotesCompose')}
        onPair={() => navigation.navigate('Pairing')}
      />
      <IntroOverlay visible={showIntro} onDismiss={dismissIntro} />
    </>
  );
}
