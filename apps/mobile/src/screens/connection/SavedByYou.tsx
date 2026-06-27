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
  /** Cached body of the saved post, if we have it locally. Drives the
   *  preview line in the list and the "Add to notes" path. */
  readonly bodyPreview: string | null;
}

export interface SavedByYouProps {
  readonly items: ReadonlyArray<SavedByYouItem>;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onBack: () => void;
  /** Open the action sheet for a saved post: Add to shared / Add to secret
   *  / Open / Remove. The route handles the action sheet itself. */
  readonly onSelect: (item: SavedByYouItem) => void;
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
              onPress={() => props.onSelect(item)}
              style={styles.row}
            >
              {item.bodyPreview != null && item.bodyPreview.length > 0 ? (
                <Text style={styles.rowBody} numberOfLines={3}>
                  {item.bodyPreview}
                </Text>
              ) : (
                <Text style={styles.rowBodyMissing}>
                  Saved post · body not on this device · pull to refresh
                </Text>
              )}
              <Text style={styles.rowMeta}>saved {isoDate(item.createdAt)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View testID="saved-by-you.empty" style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing saved yet</Text>
              <Text style={styles.emptyBody}>
                Tap “Save” on a public post in the feed to bookmark it here.
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
  rowBody: { color: '#f5f5f5', fontSize: 15, lineHeight: 22 },
  rowBodyMissing: { color: '#7a7a7a', fontSize: 13, fontStyle: 'italic' },
  rowMeta: { color: '#808080', fontSize: 12 },
  empty: { paddingTop: 80, alignItems: 'center', gap: 8 },
  emptyTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  emptyBody: { color: '#808080', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
