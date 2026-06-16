import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PostFlagCategory } from '@secretnotebook/shared-types';
import { useCallback } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useApiStore } from '../../features/api/store';
import { useFlagPost, useHidePost, usePostDetail } from '../../features/api/queries';
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
