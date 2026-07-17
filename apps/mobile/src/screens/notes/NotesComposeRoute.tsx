import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import {
  createExpoAudioRecorder,
  createExpoFileStore,
  createExpoMediaSource,
} from '../../features/attachments/native';
import { prepareAttachment } from '../../features/attachments/pipeline';
import type { PickedMedia, PreparedAttachment } from '../../features/attachments/types';
import { recordFlush, recordSyncError } from '../../features/connection-channel/debug-store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { randomUuidV4 } from '../../features/connection-channel/uuid';
import { submitNoteCompose } from '../../features/notes/compose-wiring';
import {
  getPendingNote,
  updatePendingNote,
  writePendingNote,
} from '../../features/notes/pending-store';
import { getTermState } from '../../features/safeword/term-store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { NotesCompose, type ComposeInput, type StagedMedia } from './NotesCompose';

interface StagedItem extends StagedMedia {
  prepared?: PreparedAttachment;
}

/**
 * Production wiring for NotesCompose. Pulls the SqlExecutor + SyncEngine off
 * the singleton stores and the ApiClient off useApiStore. Media is encrypted
 * and uploaded the moment it's picked/recorded (so the chip shows progress);
 * submit then hands the ready PreparedAttachments to submitNoteCompose, which
 * writes the note + attachment rows and enqueues the op.
 */
export function NotesComposeRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'NotesCompose'>>();
  const draftId = route.params?.draftId;
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const apiClient = useApiStore((s) => s.client);
  const [termNotSet, setTermNotSet] = useState(false);
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  // Prefill when editing a draft: undefined = still loading it, null = a
  // fresh compose with nothing to prefill.
  const [initial, setInitial] = useState<ComposeInput | null | undefined>(
    draftId ? undefined : null,
  );

  useEffect(() => {
    if (!exec || !draftId) return;
    let cancelled = false;
    void getPendingNote(exec, draftId).then((d) => {
      if (cancelled) return;
      // Draft gone (discarded elsewhere) → fall back to a fresh compose.
      setInitial(d ? { kind: d.kind, body: d.body, ...(d.title ? { title: d.title } : {}) } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [exec, draftId]);

  const mediaSource = useMemo(() => createExpoMediaSource(), []);
  const recorder = useMemo(() => createExpoAudioRecorder(), []);
  const fileStore = useMemo(() => createExpoFileStore(), []);

  useEffect(() => {
    if (!exec || !engine) return;
    let cancelled = false;
    void getTermState(exec, engine.selfPub).then((s) => {
      if (!cancelled) setTermNotSet(s.kind === 'none');
    });
    return () => {
      cancelled = true;
    };
  }, [exec, engine]);

  const stageAndPrepare = useCallback(
    async (picked: PickedMedia | null) => {
      if (!picked) return;
      if (!apiClient) {
        Alert.alert('Attachment unavailable', 'No signed API session yet — try again in a moment.');
        return;
      }
      const id = await randomUuidV4();
      setStaged((s) => [
        ...s,
        {
          id,
          mediaType: picked.mediaType,
          status: 'preparing',
          previewUri: picked.mediaType === 'image' ? picked.uri : undefined,
        },
      ]);
      try {
        // Tag the two external steps (file read + blob upload) so a failure
        // says which one threw; encrypt/local-write failures surface raw.
        const prepared = await prepareAttachment(
          {
            fileStore: {
              ...fileStore,
              readFile: async (uri) => {
                try {
                  return await fileStore.readFile(uri);
                } catch (e) {
                  throw new Error(`readFile: ${(e as Error)?.message ?? String(e)}`);
                }
              },
            },
            uploadBlob: async (ct) => {
              try {
                return await apiClient.uploadBlob(ct);
              } catch (e) {
                throw new Error(`uploadBlob(${ct.length}B): ${(e as Error)?.message ?? String(e)}`);
              }
            },
          },
          picked,
        );
        setStaged((s) => s.map((m) => (m.id === id ? { ...m, status: 'ready', prepared } : m)));
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        // Reaches Metro if connected; the Alert + chip make it visible on a
        // device with no debugger attached.
        console.warn('[attachment] prepare failed:', e);
        Alert.alert('Attachment failed', msg);
        setStaged((s) => s.map((m) => (m.id === id ? { ...m, status: 'error', error: msg } : m)));
      }
    },
    [apiClient, fileStore],
  );

  const onToggleRecord = useCallback(async () => {
    if (!isRecording) {
      try {
        await recorder.start();
        setIsRecording(true);
      } catch {
        setIsRecording(false);
      }
      return;
    }
    setIsRecording(false);
    const picked = await recorder.stop();
    await stageAndPrepare(picked);
  }, [isRecording, recorder, stageAndPrepare]);

  if (!exec || initial === undefined) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.notes-compose.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Waiting on the database…</Text>
      </SafeAreaView>
    );
  }

  // Media (encrypt + upload) needs both the connection identity and the API;
  // an unpaired draft is text-only, and a draft being edited stays text-only
  // (the pending_note table carries no attachments).
  const mediaReady = engine != null && apiClient != null && draftId == null;

  // Save-as-draft is offered as a secondary action only when already paired
  // and composing fresh — when unpaired the primary Save already writes a
  // draft, and while editing a draft the primary Save updates it in place.
  const saveAsDraft =
    engine != null && draftId == null
      ? async ({ kind, body, title }: ComposeInput): Promise<string | null> => {
          try {
            await writePendingNote(exec, { kind, body, ...(title ? { title } : {}) });
            navigation.goBack();
            return null;
          } catch (e) {
            return (e as Error).message ?? 'Could not save draft';
          }
        }
      : undefined;

  return (
    <NotesCompose
      termNotSet={termNotSet}
      onSetTerm={() => navigation.navigate('SafeWord')}
      onCancel={() => navigation.goBack()}
      initial={initial ?? undefined}
      headerTitle={draftId ? 'Edit draft' : 'New note'}
      staged={staged}
      isRecording={isRecording}
      onAddPhoto={mediaReady ? () => void mediaSource.pickImage().then(stageAndPrepare) : undefined}
      onTakePhoto={
        mediaReady ? () => void mediaSource.captureImage().then(stageAndPrepare) : undefined
      }
      onToggleRecord={mediaReady ? () => void onToggleRecord() : undefined}
      onRemoveMedia={(id) => setStaged((s) => s.filter((m) => m.id !== id))}
      onSaveDraft={saveAsDraft}
      onSubmit={async ({ kind, body, title }) => {
        try {
          if (draftId) {
            // Editing an existing draft — update it in place, stays a draft.
            await updatePendingNote(exec, draftId, { kind, body, ...(title ? { title } : {}) });
          } else if (engine) {
            const attachments = staged
              .filter((m) => m.status === 'ready' && m.prepared)
              .map((m) => m.prepared as PreparedAttachment);
            await submitNoteCompose(
              { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
              kind,
              body,
              attachments,
              title,
            );
            // Flush the just-enqueued op now instead of waiting up to 15s
            // for the next ticker cycle, so the note reaches the partner
            // immediately. Fire-and-forget: the modal closes right away and
            // the engine logs its own result; the ticker retries on failure.
            // The result is also recorded into the diagnostics store —
            // without this, a compose-triggered flush bypasses the ticker's
            // onCycle hook and the Sync diagnostics panel would still report
            // attempted=0 even when sends are succeeding.
            void engine
              .flush()
              .then((flushed) => recordFlush(engine, flushed))
              .catch((e) => recordSyncError('flush', (e as Error).message));
          } else {
            // No partner yet — save a draft for first-connection triage.
            await writePendingNote(exec, { kind, body, ...(title ? { title } : {}) });
          }
          navigation.goBack();
          return null;
        } catch (e) {
          return (e as Error).message ?? 'Could not save note';
        }
      }}
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
