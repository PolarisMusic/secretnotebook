import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { isPostHidden } from '../../features/api/cache';
import { useApiStore } from '../../features/api/store';
import { useFlagPost, useHidePost, usePostDetail, useUnhidePost } from '../../features/api/queries';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { promptForFlag } from '../../features/feed/flag-prompt';
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
  const unhideMut = useUnhidePost({ exec });
  const flagMut = useFlagPost({ client: client! });

  // Whether THIS post is locally hidden, so PostDetail can collapse it +
  // surface "Unhide". Refreshed on focus so a hide done elsewhere reflects.
  const [hiddenLocally, setHiddenLocally] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!exec) return;
      let cancelled = false;
      void isPostHidden(exec, route.params.id).then((h) => {
        if (!cancelled) setHiddenLocally(h);
      });
      return () => {
        cancelled = true;
      };
    }, [exec, route.params.id]),
  );

  const onHide = useCallback(
    async (id: string) => {
      await hideMut.mutateAsync(id);
      setHiddenLocally(true);
      // Stay on screen so the collapsed state + Show anyway are reachable
      // without bouncing back to the feed.
    },
    [hideMut],
  );
  const onUnhide = useCallback(
    async (id: string) => {
      await unhideMut.mutateAsync(id);
      setHiddenLocally(false);
    },
    [unhideMut],
  );
  const onFlag = useCallback(
    (_id: string) => {
      void promptForFlag((category, detail) =>
        flagMut.mutateAsync({
          id: route.params.id,
          category,
          ...(detail !== undefined ? { detail } : {}),
        }),
      );
    },
    [flagMut, route.params.id],
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
      onHide={(id) => void onHide(id)}
      onUnhide={(id) => void onUnhide(id)}
      onFlag={onFlag}
      onSaveToNotes={engine ? onSaveToNotes : undefined}
      hiddenLocally={hiddenLocally}
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
