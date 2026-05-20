import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface SavedForYouProps {
  /** Total rows where saved_for_pubkey = me. */
  readonly total: number;
  /** Subset with unlocked_at IS NULL. The number on the locked-count tile. */
  readonly locked: number;
  /** Subset with unlocked_at IS NOT NULL. */
  readonly unlocked: number;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onBack: () => void;
  readonly onViewSavedByYou: () => void;
  /** Optional — wired only when there's at least one unlocked row. */
  readonly onOpenUnlockedList?: () => void;
}

/**
 * Phase-1 "SavedForYou" surface: a locked-count tile + an unlock CTA.
 * The spec calls out that the actual post bodies stay hidden until S7
 * unlocks them via a certified prompt — this screen never lists global
 * post ids, only counts. The unlocked tile is wired so S7 can hand
 * users a place to browse what's been opened so far.
 */
export function SavedForYou(props: SavedForYouProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.saved-for-you">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={props.isRefreshing}
            onRefresh={props.onRefresh}
            tintColor="#f5f5f5"
          />
        }
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={props.onBack} testID="saved-for-you.back">
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Saved for you</Text>
          <Pressable
            accessibilityRole="button"
            onPress={props.onViewSavedByYou}
            testID="saved-for-you.view-by-you"
          >
            <Text style={styles.linkRight}>By you ›</Text>
          </Pressable>
        </View>

        <View style={styles.tile} testID="saved-for-you.locked-tile">
          <Text style={styles.tileLabel}>Locked</Text>
          <Text style={styles.tileCount}>{props.locked}</Text>
          <Text style={styles.tileHint}>Complete a prompt to unlock one.</Text>
        </View>

        <View style={styles.tile} testID="saved-for-you.unlocked-tile">
          <Text style={styles.tileLabel}>Unlocked</Text>
          <Text style={styles.tileCount}>{props.unlocked}</Text>
          {props.unlocked > 0 && props.onOpenUnlockedList ? (
            <Pressable
              accessibilityRole="button"
              onPress={props.onOpenUnlockedList}
              testID="saved-for-you.open-unlocked"
              style={styles.tileLink}
            >
              <Text style={styles.tileLinkText}>Browse →</Text>
            </Pressable>
          ) : (
            <Text style={styles.tileHint}>Nothing here yet — wait for S7.</Text>
          )}
        </View>

        <Text style={styles.totalLine} testID="saved-for-you.total">
          {props.total === 0
            ? 'Your partner hasn’t saved anything for you yet.'
            : `${props.total} total · ${props.locked} locked · ${props.unlocked} unlocked`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scrollContent: { paddingBottom: 32 },
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
  linkRight: { color: '#9ec5ff', fontSize: 15 },
  tile: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 18,
    backgroundColor: '#161616',
    borderRadius: 12,
    gap: 8,
  },
  tileLabel: { color: '#9e9e9e', fontSize: 13, letterSpacing: 0.5 },
  tileCount: { color: '#f5f5f5', fontSize: 32, fontWeight: '700' },
  tileHint: { color: '#808080', fontSize: 13 },
  tileLink: { paddingTop: 4 },
  tileLinkText: { color: '#9ec5ff', fontSize: 14, fontWeight: '600' },
  totalLine: { color: '#5e5e5e', fontSize: 12, textAlign: 'center', paddingTop: 24 },
});
