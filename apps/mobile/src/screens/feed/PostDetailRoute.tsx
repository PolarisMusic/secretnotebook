import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PostFlagCategory } from '@secretnotebook/shared-types';
import { useCallback } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { useFlagPost, useHidePost, usePostDetail } from '../../features/api/queries';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { writeSecretNote, writeSharedNote, type NoteStoreDeps } from '../../features/notes/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { PostDetail } from './PostDetail';

/**
 * Production wiring for PostDetail. Reads `id` from the navigation
 * route, queries the API (write-throughs into `post_cache`), and renders
 * the screen.
 */
export function PostDetailRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'PostDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const client = useApiStore((s) => s.client);
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);

  const query = usePostDetail({
    client: client!,
    exec,
    id: route.params.id,
    enabled: client != null,
  });
  const hideMut = useHidePost({ exec });
  const flagMut = useFlagPost({ client: client! });

  const onHide = useCallback(
    (id: string) => {
      hideMut.mutate(id);
      navigation.goBack(); // it's now hidden from the feed; nothing to show here
    },
    [hideMut, navigation],
  );
  const onFlag = useCallback(
    (id: string) => {
      const choices: ReadonlyArray<{ label: string; category: PostFlagCategory }> = [
        { label: 'Sexual content', category: 'sexual' },
        { label: 'Violence', category: 'violent' },
        { label: 'Spam', category: 'spam' },
        { label: 'Other', category: 'other' },
      ];
      Alert.alert(
        'Flag this post',
        'Why are you reporting it? This hides the content for everyone.',
        [
          ...choices.map((c) => ({
            text: c.label,
            onPress: () => flagMut.mutate({ id, category: c.category }),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    },
    [flagMut],
  );

  const saveToNotes = useCallback(
    async (kind: 'shared' | 'secret', body: string): Promise<void> => {
      if (!exec || !engine) return;
      const deps: NoteStoreDeps = {
        exec,
        selfPubkey: engine.selfPub,
        enqueue: (op) => engine.enqueue(op),
      };
      try {
        if (kind === 'secret') await writeSecretNote(deps, body);
        else await writeSharedNote(deps, body);
        Alert.alert(
          'Saved',
          kind === 'secret' ? 'Added to your secret notes.' : 'Added to your shared notes.',
        );
      } catch (e) {
        Alert.alert('Could not save', (e as Error).message);
      }
    },
    [exec, engine],
  );

  const onSaveToNotes = useCallback(
    (id: string) => {
      const post = query.data;
      if (!post || post.id !== id) return;
      const body = post.body.trim();
      if (body.length === 0) {
        Alert.alert('Nothing to save', 'This post has no text to add to your notes.');
        return;
      }
      Alert.alert('Save to notes', "Add this post's text to your couple's notes.", [
        { text: 'Shared note', onPress: () => void saveToNotes('shared', body) },
        { text: 'Secret note', onPress: () => void saveToNotes('secret', body) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [query.data, saveToNotes],
  );

  if (!client) {
    return (
      <SafeAreaView style={styles.gate} testID="screen.post-detail.waiting">
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.gateText}>Preparing your signed session…</Text>
      </SafeAreaView>
    );
  }

  return (
    <PostDetail
      post={query.data ?? null}
      isLoading={query.isLoading}
      error={query.error}
      onBack={() => navigation.goBack()}
      onHide={onHide}
      onFlag={onFlag}
      onSaveToNotes={engine ? onSaveToNotes : undefined}
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
