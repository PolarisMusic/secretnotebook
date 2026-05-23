import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { usePostDetail } from '../../features/api/queries';
import { saveForPartner } from '../../features/couple-channel/save-for-partner';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { PostDetail } from './PostDetail';

/**
 * Production wiring for PostDetail. Reads `id` from the navigation
 * route, queries the API (write-throughs into `post_cache`), and renders
 * the screen. `onSaveForPartner` is wired iff the sync engine is ready
 * (couple paired + couple_ratchet seeded + ApiClient available); on
 * unpaired devices the button stays hidden.
 */
export function PostDetailRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'PostDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const client = useApiStore((s) => s.client);
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const query = usePostDetail({
    client: client!,
    exec,
    id: route.params.id,
    enabled: client != null,
  });

  if (!client) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.post-detail.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Preparing your signed session…</Text>
      </SafeAreaView>
    );
  }

  const canSave = exec != null && engine != null && query.data != null;
  const onSaveForPartner = canSave
    ? async (): Promise<void> => {
        try {
          await saveForPartner({
            exec: exec!,
            engine: engine!,
            globalPostId: query.data!.id,
            savedByPubkey: engine!.selfPub,
            savedForPubkey: engine!.peerPub,
          });
          // Best-effort: kick the outbox so the partner can pull soon.
          void engine!.flush().catch(() => undefined);
          setSavedNotice('Saved for your partner.');
        } catch (e) {
          setSavedNotice((e as Error).message ?? "Couldn't save");
        }
      }
    : undefined;

  return (
    <PostDetail
      post={query.data ?? null}
      isLoading={query.isLoading}
      error={query.error}
      onBack={() => navigation.goBack()}
      onSaveForPartner={onSaveForPartner}
      saveNotice={savedNotice}
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
