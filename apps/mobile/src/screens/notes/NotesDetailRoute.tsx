import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { getNote, revealSecretNote, type NoteRow } from '../../features/notes/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { NotesDetail } from './NotesDetail';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Production wiring for NotesDetail. Reads the row by id and exposes the
 * Reveal affordance when the device is the author. Publishing to the global
 * feed now lives in the Feed's composer, not here — the focus of a note is
 * the connected partner.
 */
export function NotesDetailRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'NotesDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [note, setNote] = useState<NoteRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!exec) return;
    const row = await getNote(exec, route.params.id);
    setNote(row);
    setLoading(false);
  }, [exec, route.params.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!exec) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.notes-detail.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Loading note…</Text>
      </SafeAreaView>
    );
  }

  const isAuthor = note != null && engine != null && sameBytes(note.authorPubkey, engine.selfPub);

  async function handleReveal(): Promise<void> {
    if (!engine || !note) return;
    setBusy(true);
    setError(null);
    try {
      await revealSecretNote(
        { exec: exec!, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
        note.id,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message ?? 'Could not reveal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <NotesDetail
      note={note}
      isLoading={loading}
      isAuthor={isAuthor}
      busy={busy}
      error={error}
      onBack={() => navigation.goBack()}
      onReveal={() => void handleReveal()}
      onOpenPublishedPost={(id) => navigation.navigate('PostDetail', { id })}
    />
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  gateText: { color: '#9e9e9e', fontSize: 14 },
});
