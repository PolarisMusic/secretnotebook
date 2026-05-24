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
  /** Optional — hidden on unpaired devices (no Saved area to navigate to). */
  readonly onOpenSaved?: () => void;
  /** Optional — hidden on unpaired devices. Opens ConnectionHome. */
  readonly onOpenConnection?: () => void;
}

/**
 * Presentational feed screen. State + side-effects live in the parent
 * (GlobalFeedRoute, which wires `usePostsFeed` from features/api).
 *
 * Two reasons it's structured this way:
 *   1. The query hook needs a QueryClientProvider in the tree; tests
 *      that focus on rendering can build a fixed `items` snapshot
 *      without spinning one up.
 *   2. The same screen renders both the empty state and the loaded
 *      state, so all conditional logic lives next to the JSX.
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
    <SafeAreaView style={styles.container} testID="screen.global-feed">
      <View style={styles.header}>
        <Text style={styles.title}>Global feed</Text>
        <View style={styles.headerActions}>
          {props.onOpenConnection ? (
            <Pressable
              accessibilityRole="button"
              testID="feed.open-connection"
              onPress={props.onOpenConnection}
              style={styles.savedButton}
            >
              <Text style={styles.savedButtonText}>Connection</Text>
            </Pressable>
          ) : null}
          {props.onOpenSaved ? (
            <Pressable
              accessibilityRole="button"
              testID="feed.open-saved"
              onPress={props.onOpenSaved}
              style={styles.savedButton}
            >
              <Text style={styles.savedButtonText}>Saved</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            testID="feed.compose"
            onPress={props.onCompose}
            style={styles.composeButton}
          >
            <Text style={styles.composeButtonText}>+ Post</Text>
          </Pressable>
        </View>
      </View>

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
              Tap “+ Post” to share something — or pull to refresh.
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: { color: '#f5f5f5', fontSize: 22, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedButton: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  savedButtonText: { color: '#9ec5ff', fontWeight: '600' },
  composeButton: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  composeButtonText: { color: '#f5f5f5', fontWeight: '600' },
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
