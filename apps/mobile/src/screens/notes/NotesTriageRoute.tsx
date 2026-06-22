import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '../../components/ScreenHeader';
import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { notesToJson } from '../../features/notes/export';
import {
  discardPendingNote,
  listPendingNotes,
  sharePendingNote,
  type PendingNoteRow,
} from '../../features/notes/pending-store';
import { shareTextFile } from '../../features/notes/share-native';
import type { MainStackParamList } from '../../navigation/MainStack';

type Nav = NativeStackNavigationProp<MainStackParamList>;

/**
 * First-connection triage (item I). Lists the drafts authored before pairing
 * and lets the user, per note, Share it into the couple's notes or Archive it
 * (the archived set is exported as one JSON file when the list is cleared).
 * Reached from onPaired when drafts exist; finishing returns to the notes list.
 */
export function NotesTriageRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [drafts, setDrafts] = useState<PendingNoteRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const archivedRef = useRef<PendingNoteRow[]>([]);
  const finishedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!exec) return;
    setDrafts(await listPendingNotes(exec));
  }, [exec]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const archived = archivedRef.current;
    if (archived.length > 0) {
      try {
        await shareTextFile(
          'usnotes-drafts-archive.json',
          notesToJson(archived),
          'application/json',
        );
      } catch {
        // best-effort archive — don't trap the user in triage on a share failure
      }
    }
    navigation.navigate('NotesList');
  }, [navigation]);

  const onShare = useCallback(
    async (note: PendingNoteRow) => {
      if (!exec || !engine || busy) return;
      setBusy(true);
      try {
        await sharePendingNote(
          { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
          note.id,
        );
        await refresh();
      } catch (e) {
        Alert.alert('Could not share', (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [exec, engine, busy, refresh],
  );

  const onArchive = useCallback(
    async (note: PendingNoteRow) => {
      if (!exec || busy) return;
      setBusy(true);
      try {
        archivedRef.current = [...archivedRef.current, note];
        await discardPendingNote(exec, note.id);
        await refresh();
      } catch (e) {
        Alert.alert('Could not archive', (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [exec, busy, refresh],
  );

  // Auto-finish once every draft has been triaged.
  useEffect(() => {
    if (drafts !== null && drafts.length === 0) void finish();
  }, [drafts, finish]);

  if (drafts === null) {
    return (
      <SafeAreaView style={styles.loading} testID="screen.notes-triage.loading">
        <ActivityIndicator color="#f5f5f5" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.notes-triage">
      <ScreenHeader title="Your earlier notes" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.body}>
          You wrote {drafts.length} {drafts.length === 1 ? 'note' : 'notes'} before connecting.
          Share each with your partner, or archive it — archived notes are exported when you finish.
        </Text>
        {drafts.map((n) => (
          <View key={n.id} style={styles.card}>
            <Text style={styles.kind}>{n.kind === 'secret' ? 'SECRET' : 'SHARED'}</Text>
            <Text style={styles.noteBody} numberOfLines={4}>
              {n.body}
            </Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                style={[styles.btn, styles.share]}
                disabled={busy}
                hitSlop={6}
                onPress={() => void onShare(n)}
                testID={`triage.share.${n.id}`}
              >
                <Text style={styles.shareText}>Share</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[styles.btn, styles.archive]}
                disabled={busy}
                hitSlop={6}
                onPress={() => void onArchive(n)}
                testID={`triage.archive.${n.id}`}
              >
                <Text style={styles.archiveText}>Archive</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          style={styles.done}
          onPress={() => void finish()}
          testID="triage.done"
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  loading: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  body: { color: '#a0a0a0', fontSize: 14, lineHeight: 20, marginTop: 8 },
  card: { backgroundColor: '#141414', borderRadius: 10, padding: 16, gap: 8 },
  kind: { color: '#7a7a7a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  noteBody: { color: '#f5f5f5', fontSize: 16, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  share: { backgroundColor: '#9ec5ff' },
  shareText: { color: '#0a0a0a', fontSize: 15, fontWeight: '700' },
  archive: { backgroundColor: '#2a2a2a' },
  archiveText: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  done: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  doneText: { color: '#9ec5ff', fontSize: 16, fontWeight: '600' },
});
