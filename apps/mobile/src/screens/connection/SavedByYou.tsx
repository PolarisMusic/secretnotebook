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

export interface SavedByYouItem {
  /** Local saved_post.id (UUID). */
  readonly savedPostId: string;
  /** Global post id — the row in the public feed we saved. */
  readonly globalPostId: string;
  /** Unix seconds. */
  readonly createdAt: number;
}

export interface SavedByYouProps {
  readonly items: ReadonlyArray<SavedByYouItem>;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onBack: () => void;
  readonly onSelect: (globalPostId: string) => void;
}

function isoDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

export function SavedByYou(props: SavedByYouProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.saved-by-you">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="saved-by-you.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Saved by you</Text>
        <View style={styles.headerSpacer} />
      </View>

      {props.isLoading ? (
        <View style={styles.center} testID="saved-by-you.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      ) : (
        <FlatList
          data={props.items as SavedByYouItem[]}
          keyExtractor={(it) => it.savedPostId}
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
              testID={`saved-by-you.row.${item.savedPostId}`}
              onPress={() => props.onSelect(item.globalPostId)}
              style={styles.row}
            >
              <Text style={styles.rowGlobal}>{item.globalPostId.slice(0, 8)}…</Text>
              <Text style={styles.rowMeta}>saved {isoDate(item.createdAt)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View testID="saved-by-you.empty" style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing saved yet</Text>
              <Text style={styles.emptyBody}>
                The save action lands when the post / pin flow comes back online.
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
  rowGlobal: { color: '#f5f5f5', fontSize: 14, fontWeight: '600' },
  rowMeta: { color: '#808080', fontSize: 12 },
  empty: { paddingTop: 80, alignItems: 'center', gap: 8 },
  emptyTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  emptyBody: { color: '#808080', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
