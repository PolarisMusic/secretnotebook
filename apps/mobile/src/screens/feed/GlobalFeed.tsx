import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Post } from '@secretnotebook/shared-types';

import { ScreenHeader } from '../../components/ScreenHeader';

export interface GlobalFeedProps {
  readonly items: ReadonlyArray<Post>;
  readonly isRefreshing: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly error: Error | null;
  readonly onRefresh: () => void;
  readonly onLoadMore: () => void;
  readonly onSelectPost: (id: string) => void;
  readonly onCompose: () => void;
}

/**
 * Presentational feed screen. State + side-effects live in GlobalFeedRoute.
 * Navigation between Notes/Saved/Settings is via the hamburger menu in the
 * shared header; the only header action here is a comfortably-tappable Post
 * button (the old tiny pill was nearly impossible to hit).
 */
export function GlobalFeed(props: GlobalFeedProps): JSX.Element {
  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <Pressable
        accessibilityRole="button"
        testID={`feed.post.${item.id}`}
        onPress={() => props.onSelectPost(item.id)}
        style={styles.row}
      >
        <Text style={styles.rowBody} numberOfLines={3}>
          {item.body}
        </Text>
        <Text style={styles.rowMeta}>
          {item.contentType.toUpperCase()} · {item.anonAuthor.slice(0, 8)}…
        </Text>
      </Pressable>
    ),
    [props],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.global-feed">
      <ScreenHeader
        title="Feed"
        right={
          <Pressable
            accessibilityRole="button"
            testID="feed.compose"
            onPress={props.onCompose}
            style={styles.postButton}
            hitSlop={10}
          >
            <Text style={styles.postButtonText}>Post</Text>
          </Pressable>
        }
      />

      {props.error ? (
        <View testID="feed.error" style={styles.errorBox}>
          <Text style={styles.errorText}>Couldn't load the feed: {props.error.message}</Text>
        </View>
      ) : null}

      <FlatList
        data={props.items as Post[]}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={props.isRefreshing}
            onRefresh={props.onRefresh}
            tintColor="#f5f5f5"
          />
        }
        onEndReached={() => {
          if (props.hasNextPage && !props.isFetchingNextPage) props.onLoadMore();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <View testID="feed.empty" style={styles.empty}>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyBody}>
              Tap “Post” to share something — or pull to refresh.
            </Text>
          </View>
        }
        ListFooterComponent={
          props.isFetchingNextPage ? (
            <ActivityIndicator testID="feed.loading-more" style={styles.footer} color="#f5f5f5" />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  postButton: {
    backgroundColor: '#3a3a3a',
    paddingHorizontal: 16,
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postButtonText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    backgroundColor: '#161616',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    gap: 6,
  },
  rowBody: { color: '#f5f5f5', fontSize: 15, lineHeight: 20 },
  rowMeta: { color: '#808080', fontSize: 12 },
  empty: { paddingTop: 80, alignItems: 'center', gap: 8 },
  emptyTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  emptyBody: { color: '#808080', fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  footer: { paddingVertical: 16 },
  errorBox: {
    backgroundColor: '#3a1f1f',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
  },
  errorText: { color: '#ffb4b4', fontSize: 13 },
});
