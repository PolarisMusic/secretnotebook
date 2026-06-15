import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { createExpoFileStore, playAudioFile } from '../../features/attachments/native';
import { downloadAttachment, openAttachment } from '../../features/attachments/pipeline';
import { listNoteAttachments } from '../../features/attachments/store';
import type { AttachmentRow } from '../../features/attachments/types';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { getNote, revealSecretNote, type NoteRow } from '../../features/notes/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { NotesDetail, type DetailAttachment } from './NotesDetail';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Production wiring for NotesDetail. Reads the row + its attachments, exposes
 * Reveal when the device is the author, and lazily downloads + decrypts media
 * to a (lock-cleared) cache file when the user taps to load it.
 */
export function NotesDetailRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'NotesDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const apiClient = useApiStore((s) => s.client);
  const [note, setNote] = useState<NoteRow | null>(null);
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileStore = useMemo(() => createExpoFileStore(), []);

  const refresh = useCallback(async () => {
    if (!exec) return;
    const row = await getNote(exec, route.params.id);
    setNote(row);
    setRows(await listNoteAttachments(exec, route.params.id));
    setLoading(false);
  }, [exec, route.params.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleOpenAttachment = useCallback(
    async (id: string) => {
      if (!exec || !apiClient) return;
      setError(null);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, state: 'downloading' } : r)));
      try {
        await downloadAttachment(
          { exec, fileStore, downloadBlob: (blobId) => apiClient.downloadBlob(blobId) },
          id,
        );
        const opened = await openAttachment({ exec, fileStore }, id);
        setPreviews((p) => ({ ...p, [id]: opened.uri }));
      } catch {
        setError('Could not load media.');
      } finally {
        setRows(await listNoteAttachments(exec, route.params.id));
      }
    },
    [exec, apiClient, fileStore, route.params.id],
  );

  if (!exec) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.notes-detail.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Loading note…</Text>
      </SafeAreaView>
    );
  }

  const isAuthor = note != null && engine != null && sameBytes(note.authorPubkey, engine.selfPub);

  const attachments: DetailAttachment[] = rows.map((r) => ({
    id: r.id,
    mediaType: r.mediaType,
    state: r.state,
    previewUri: previews[r.id] ?? null,
  }));

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
      attachments={attachments}
      onOpenAttachment={(id) => void handleOpenAttachment(id)}
      onPlayAudio={(id) => {
        const uri = previews[id];
        if (uri) void playAudioFile(uri);
      }}
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
