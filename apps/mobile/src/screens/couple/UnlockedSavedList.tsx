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

export interface UnlockedItem {
  /** Local saved_post.id (UUID). */
  readonly savedPostId: string;
  /** Global post id — the cached body lives at post_cache.global_id. */
  readonly globalPostId: string;
  /** Body preview from post_cache; null if we haven't fetched it yet. */
  readonly bodyPreview: string | null;
  /** seconds since epoch — drives the meta line. */
  readonly unlockedAt: number;
}

export interface UnlockedSavedListProps {
  readonly items: ReadonlyArray<UnlockedItem>;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onBack: () => void;
  readonly onSelect: (globalPostId: string) => void;
}

function isoDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

export function UnlockedSavedList(props: UnlockedSavedListProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.unlocked-saved-list">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={props.onBack}
          testID="unlocked-saved-list.back"
        >
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Unlocked</Text>
        <View style={styles.headerSpacer} />
      </View>

      {props.isLoading ? (
        <View style={styles.center} testID="unlocked-saved-list.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      ) : (
        <FlatList
          data={props.items as UnlockedItem[]}
          keyExtractor={(i) => i.savedPostId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={props.isRefreshing}
              onRefresh={props.onRefresh}
              tintColor="#f5f5f5"
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onSelect(item.globalPostId)}
              testID={`unlocked-saved-list.row.${item.savedPostId}`}
              style={styles.row}
            >
              <Text style={styles.rowBody} numberOfLines={3}>
                {item.bodyPreview ?? 'Fetching…'}
              </Text>
              <Text style={styles.rowMeta}>unlocked {isoDate(item.unlockedAt)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty} testID="unlocked-saved-list.empty">
              <Text style={styles.emptyTitle}>Nothing unlocked yet</Text>
              <Text style={styles.emptyBody}>
                When your partner certifies a prompt, one of the posts they saved for you opens
                here.
              </Text>
            </View>
          }
        />
      )}
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
    paddingTop: 12,
    paddingBottom: 12,
  },
  back: { color: '#9ec5ff', fontSize: 15 },
  title: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  headerSpacer: { width: 40 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
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
  emptyTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  emptyBody: { color: '#808080', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
