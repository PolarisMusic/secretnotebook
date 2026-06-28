import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { editNote, getNote, type NoteRow } from '../../features/notes/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { NotesEdit } from './NotesEdit';

type Rt = RouteProp<MainStackParamList, 'NotesEdit'>;
type Nav = NativeStackNavigationProp<MainStackParamList>;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Production wiring for the note editor. Loads the existing body, guards
 * permissions (matching the store) before showing the form, and hands the
 * trimmed new body to editNote(). The store handles the kind-specific
 * decision about whether to emit a wire op (shared / post-reveal secret)
 * or update locally only (pre-reveal secret).
 */
export function NotesEditRoute(): JSX.Element {
  const route = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [note, setNote] = useState<NoteRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!exec) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await getNote(exec, route.params.id);
        if (cancelled) return;
        if (!row) {
          setLoadError('Note is no longer available.');
        } else if (row.deletedAt != null) {
          setLoadError('Note has been deleted.');
        } else {
          setNote(row);
        }
      } catch (e) {
        if (!cancelled) setLoadError((e as Error)?.message ?? 'Could not load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exec, route.params.id]);

  const onSubmit = useCallback(
    async (newBody: string): Promise<string | null> => {
      if (!exec || !engine || !note) return 'Not ready';
      try {
        await editNote(
          { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
          note.id,
          newBody,
        );
        navigation.goBack();
        return null;
      } catch (e) {
        return (e as Error)?.message ?? 'Could not save';
      }
    },
    [exec, engine, note, navigation],
  );

  if (loadError != null) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.notes-edit.error">
        <Text style={styles.gateText}>{loadError}</Text>
      </SafeAreaView>
    );
  }

  if (!note || !engine) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.notes-edit.waiting">
        <ActivityIndicator color="#f5f5f5" />
      </SafeAreaView>
    );
  }

  // Local permission gate mirrors the store's: shared = either partner;
  // secret = author only. The store re-checks before emitting/saving, so
  // this is purely so the user gets an immediate inline message rather than
  // discovering the rejection on Save.
  const isAuthor = sameBytes(note.authorPubkey, engine.selfPub);
  if (note.kind === 'secret' && !isAuthor) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.notes-edit.forbidden">
        <Text style={styles.gateText}>Only the author can edit a secret note.</Text>
      </SafeAreaView>
    );
  }

  return (
    <NotesEdit
      initialBody={note.body ?? ''}
      onSubmit={onSubmit}
      onCancel={() => navigation.goBack()}
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
    paddingHorizontal: 32,
  },
  gateText: { color: '#9e9e9e', fontSize: 14, textAlign: 'center' },
});
