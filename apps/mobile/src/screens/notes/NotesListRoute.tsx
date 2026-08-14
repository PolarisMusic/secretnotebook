import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { bytesToHex } from '@secretnotebook/crypto';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import {
  discardPendingNote,
  listPendingNotes,
  sharePendingNote,
  type PendingNoteRow,
} from '../../features/notes/pending-store';
import { attachmentKindsForNotes } from '../../features/attachments/store';
import { listNotes, type NoteRow } from '../../features/notes/store';
import { refreshUnreadNotes } from '../../features/notes/unread-store';
import {
  getAppSetting,
  getNotesLastViewedAt,
  INTRO_SEEN_KEY,
  setAppSetting,
  setNotesLastViewedAt,
} from '../../features/settings/store';
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
  // Notes created after this Unix-seconds watermark (and not authored by us)
  // are surfaced as "new". Captured once per focus, before we re-stamp the
  // watermark to now, so the marker persists for the whole visit then clears.
  const [newThreshold, setNewThreshold] = useState<number | null>(null);
  const [attachmentKinds, setAttachmentKinds] = useState<
    ReadonlyMap<string, { image: boolean; audio: boolean }>
  >(new Map());

  const selfHex = useMemo(() => (engine ? bytesToHex(engine.selfPub) : null), [engine]);
  // Notes this device wrote — drives the "You" / "Partner" byline on each row.
  const myNoteIds = useMemo(() => {
    const ids = new Set<string>();
    if (items == null || selfHex == null) return ids;
    for (const n of items) if (bytesToHex(n.authorPubkey) === selfHex) ids.add(n.id);
    return ids;
  }, [items, selfHex]);
  const newNoteIds = useMemo(() => {
    const ids = new Set<string>();
    if (newThreshold == null || items == null) return ids;
    for (const n of items) {
      // A note is "new" if it arrived after the last visit and someone else
      // wrote it — your own just-composed note isn't news to you.
      if (
        n.createdAt > newThreshold &&
        (selfHex == null || bytesToHex(n.authorPubkey) !== selfHex)
      ) {
        ids.add(n.id);
      }
    }
    return ids;
  }, [items, newThreshold, selfHex]);

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
    // One batched lookup so each row can badge photo / voice attachments.
    setAttachmentKinds(
      await attachmentKindsForNotes(
        exec,
        rows.map((r) => r.id),
      ),
    );
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
      Alert.alert(draft.title ? `Draft — ${draft.title}` : 'Draft', draft.body.slice(0, 200), [
        {
          text: 'Edit',
          onPress: () => navigation.navigate('NotesCompose', { draftId: id }),
        },
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
    [drafts, exec, engine, syncLists, navigation],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // Capture the "new" watermark before re-stamping it: notes newer than
      // the last visit stay highlighted for this visit, then clear next time.
      // First run (no stored value) uses now(), so pre-existing notes aren't
      // all flagged new on upgrade.
      void (async () => {
        if (exec) {
          const stored = await getNotesLastViewedAt(exec);
          const nowSecs = Math.floor(Date.now() / 1000);
          if (active) setNewThreshold(stored ?? nowSecs);
          await setNotesLastViewedAt(exec, nowSecs);
          // Visiting the list clears the badge — the watermark just moved.
          await refreshUnreadNotes(exec, engine?.selfPub ?? null);
        }
      })();
      // On focus: pull + list once. Then re-read the DB every few seconds so
      // notes applied by the background sync ticker (App-level, every 15s)
      // appear live instead of only on the next focus / pull-to-refresh.
      void syncLists();
      const handle = setInterval(() => void loadLists(), 4000);
      return () => {
        active = false;
        clearInterval(handle);
      };
    }, [exec, engine, syncLists, loadLists]),
  );

  return (
    <>
      <NotesList
        items={items ?? []}
        newNoteIds={newNoteIds}
        myNoteIds={myNoteIds}
        attachmentKinds={attachmentKinds}
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
      <IntroOverlay
        visible={showIntro}
        onDismiss={dismissIntro}
        onPair={() => navigation.navigate('Pairing')}
      />
    </>
  );
}
