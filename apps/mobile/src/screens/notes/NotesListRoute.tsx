import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import {
  discardPendingNote,
  listPendingNotes,
  sharePendingNote,
  type PendingNoteRow,
} from '../../features/notes/pending-store';
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
  const [drafts, setDrafts] = useState<PendingNoteRow[]>([]);
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

  // List-only re-read (no engine.pull). Never touches isRefreshing, so it
  // can't strand the pull-to-refresh spinner.
  const loadLists = useCallback(async () => {
    if (!exec) {
      setItems([]);
      setDrafts([]);
      return;
    }
    // Drafts (pending_note) surface above the notes list so a pre-pairing
    // note doesn't appear to vanish; the tap-action sheet promotes or
    // discards them per pending-store.
    const [rows, draftRows] = await Promise.all([listNotes(exec), listPendingNotes(exec)]);
    setItems(rows);
    setDrafts(draftRows);
  }, [exec]);

  // Pull the engine, then re-read. Used on focus + after draft actions.
  // Deliberately does NOT drive isRefreshing: toggling the RefreshControl
  // spinner programmatically (outside a user pull gesture) leaves it stranded
  // on screen on iOS — that was the "refresh circle stays up after returning
  // from a note" bug. Only onPullToRefresh below drives the spinner.
  const syncLists = useCallback(async () => {
    if (engine) {
      try {
        await engine.pull();
      } catch {
        // best-effort
      }
    }
    await loadLists();
  }, [engine, loadLists]);

  // The one path that owns the spinner — a real user pull-to-refresh.
  const onPullToRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await syncLists();
    } finally {
      setIsRefreshing(false);
    }
  }, [syncLists]);

  const onSelectDraft = useCallback(
    (id: string) => {
      const draft = drafts.find((d) => d.id === id);
      if (!exec || !draft) return;
      // The action sheet differs by pairing state: without a SyncEngine we
      // can't share, so only Discard / Cancel are offered.
      const shareShared = engine
        ? [
            {
              text: 'Share as shared note',
              onPress: () => {
                void (async () => {
                  try {
                    await sharePendingNote(
                      { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
                      id,
                    );
                    await syncLists();
                  } catch (e) {
                    Alert.alert('Could not share', (e as Error).message);
                  }
                })();
              },
            },
            {
              text: 'Save as secret note',
              onPress: () => {
                void (async () => {
                  try {
                    // sharePendingNote uses the draft's own kind; for the
                    // "save as secret" affordance we update the draft first.
                    // The pending-store doesn't expose an update, so do it
                    // inline (the table is device-local, no sync impact).
                    if (draft.kind !== 'secret') {
                      await exec.execute(`UPDATE pending_note SET kind = 'secret' WHERE id = ?`, [
                        id,
                      ]);
                    }
                    await sharePendingNote(
                      { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
                      id,
                    );
                    await syncLists();
                  } catch (e) {
                    Alert.alert('Could not save', (e as Error).message);
                  }
                })();
              },
            },
          ]
        : [];
      Alert.alert('Draft', draft.body.slice(0, 200), [
        ...shareShared,
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await discardPendingNote(exec, id);
                await syncLists();
              } catch (e) {
                Alert.alert('Could not discard', (e as Error).message);
              }
            })();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [drafts, exec, engine, syncLists],
  );

  useFocusEffect(
    useCallback(() => {
      // On focus: pull + list once. Then re-read the DB every few seconds so
      // notes applied by the background sync ticker (App-level, every 15s)
      // appear live instead of only on the next focus / pull-to-refresh.
      void syncLists();
      const handle = setInterval(() => void loadLists(), 4000);
      return () => clearInterval(handle);
    }, [syncLists, loadLists]),
  );

  return (
    <>
      <NotesList
        items={items ?? []}
        drafts={drafts}
        isLoading={items == null}
        isRefreshing={isRefreshing}
        paired={status === 'paired'}
        onRefresh={() => void onPullToRefresh()}
        onSelectNote={(id) => navigation.navigate('NotesDetail', { id })}
        onSelectDraft={onSelectDraft}
        onCompose={() => navigation.navigate('NotesCompose')}
        onPair={() => navigation.navigate('Pairing')}
      />
      <IntroOverlay visible={showIntro} onDismiss={dismissIntro} />
    </>
  );
}
