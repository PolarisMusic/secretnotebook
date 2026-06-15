import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { useSubmitPost } from '../../features/api/queries';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { EntitlementError, requireCurrentEntitlement } from '../../features/iap/store';
import { publishMyNote } from '../../features/notes/publish';
import { listNotes } from '../../features/notes/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SubmitPost } from './SubmitPost';

const MAX_NOTE_OPTIONS = 8;

function entitlementMessage(e: EntitlementError): string {
  return e.code === 'expired'
    ? 'Your subscription has lapsed. Renew to publish.'
    : 'Subscribe to publish.';
}

/**
 * Production wiring for SubmitPost. Two publish paths, both R5-gated:
 *   - write a brand-new post (TanStack mutation), and
 *   - publish one of your existing notes (via the canonical publishMyNote
 *     helper). Publishing from a note requires a sync engine (paired
 *     device); the note list is empty otherwise, hiding that section.
 */
export function SubmitPostRoute(): JSX.Element {
  const client = useApiStore((s) => s.client);
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const mutation = useSubmitPost({ client: client! });
  const [notes, setNotes] = useState<{ id: string; preview: string }[]>([]);

  const loadNotes = useCallback(async () => {
    if (!exec || !engine) {
      setNotes([]);
      return;
    }
    const rows = await listNotes(exec);
    setNotes(
      rows
        .filter((r) => r.publishedAt == null && r.body != null && r.body.length > 0)
        .slice(0, MAX_NOTE_OPTIONS)
        .map((r) => ({ id: r.id, preview: (r.body ?? '').slice(0, 60) })),
    );
  }, [exec, engine]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  if (!client || !exec) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.submit-post.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Preparing your signed session…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SubmitPost
      notes={engine ? notes : []}
      onCancel={() => navigation.goBack()}
      onSubmit={async (input) => {
        try {
          // Gate first — no network call / no row materialised if it refuses.
          await requireCurrentEntitlement(exec, () => new Date());
          await mutation.mutateAsync(input);
          navigation.goBack();
          return null;
        } catch (e) {
          if (e instanceof EntitlementError) return entitlementMessage(e);
          return (e as Error).message ?? 'Could not submit';
        }
      }}
      onPublishNote={
        engine
          ? async (id, audience) => {
              try {
                await publishMyNote(
                  {
                    exec,
                    engine: { selfPub: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
                    apiClient: client,
                  },
                  id,
                  { audience },
                );
                navigation.goBack();
                return null;
              } catch (e) {
                if (e instanceof EntitlementError) return entitlementMessage(e);
                return (e as Error).message ?? 'Could not publish note';
              }
            }
          : undefined
      }
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
