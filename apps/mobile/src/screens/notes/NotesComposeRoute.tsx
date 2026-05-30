import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { submitNoteCompose } from '../../features/notes/compose-wiring';
import type { MainStackParamList } from '../../navigation/MainStack';
import { NotesCompose } from './NotesCompose';

/**
 * Production wiring for NotesCompose. Pulls the SqlExecutor and
 * SyncEngine off the singleton stores; routes the form's submit
 * through `submitNoteCompose` which forwards to
 * writeSharedNote / writeSecretNote based on `kind`. Splitting the
 * forwarding into a tiny pure helper lets the Node-side Jest suite
 * verify the dispatch without rendering React Native.
 */
export function NotesComposeRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);

  if (!exec || !engine) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.notes-compose.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Waiting on connection…</Text>
      </SafeAreaView>
    );
  }

  return (
    <NotesCompose
      onCancel={() => navigation.goBack()}
      onSubmit={async ({ kind, body }) => {
        try {
          await submitNoteCompose(
            {
              exec,
              selfPubkey: engine.selfPub,
              enqueue: (op) => engine.enqueue(op),
            },
            kind,
            body,
          );
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
