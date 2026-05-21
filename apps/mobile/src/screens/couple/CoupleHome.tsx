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

export interface ActivityRow {
  readonly id: string;
  readonly delta: number;
  readonly reason: string;
  readonly createdAt: number;
}

export interface CoupleHomeProps {
  readonly totalPoints: number;
  readonly activity: ReadonlyArray<ActivityRow>;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onBack: () => void;
  /** Open prompt list (Phase-1 lever for "do something next"). */
  readonly onOpenPrompts?: () => void;
  /** Open the saved-by-you / saved-for-you area. */
  readonly onOpenSaved?: () => void;
}

const REASON_LABELS: Record<string, string> = {
  'save-for-partner': 'You saved a post for your partner',
  'prompt-certified': 'A prompt was certified',
  'roleplay-loop-completed': 'You finished a role-play loop together',
};

function isoDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

function labelFor(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/**
 * Phase-1 Couple Home — Couple Points sum + recent ledger activity.
 * The Couple Level is just the sum for now; Phase-2 may add tiers
 * or curves on top.
 */
export function CoupleHome(props: CoupleHomeProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.couple-home">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="couple-home.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Couple</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        ListHeaderComponent={
          <View style={styles.headerBody}>
            <View style={styles.tile} testID="couple-home.points-tile">
              <Text style={styles.tileLabel}>Couple Points</Text>
              <Text style={styles.tileCount}>{props.totalPoints}</Text>
              <Text style={styles.tileHint}>
                +2 per save · +10 per certified prompt · +25 per closed loop
              </Text>
            </View>
            <View style={styles.shortcuts}>
              {props.onOpenSaved ? (
                <Pressable
                  accessibilityRole="button"
                  testID="couple-home.open-saved"
                  onPress={props.onOpenSaved}
                  style={styles.shortcutButton}
                >
                  <Text style={styles.shortcutText}>Saved</Text>
                </Pressable>
              ) : null}
              {props.onOpenPrompts ? (
                <Pressable
                  accessibilityRole="button"
                  testID="couple-home.open-prompts"
                  onPress={props.onOpenPrompts}
                  style={styles.shortcutButton}
                >
                  <Text style={styles.shortcutText}>Prompts</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.sectionHeader}>Recent activity</Text>
          </View>
        }
        data={props.activity as ActivityRow[]}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl
            refreshing={props.isRefreshing}
            onRefresh={props.onRefresh}
            tintColor="#f5f5f5"
          />
        }
        renderItem={({ item }) => (
          <View style={styles.row} testID={`couple-home.row.${item.id}`}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {labelFor(item.reason)}
            </Text>
            <Text style={styles.rowMeta}>
              {isoDate(item.createdAt)} · {item.delta >= 0 ? '+' : ''}
              {item.delta}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          props.isLoading ? (
            <View style={styles.center} testID="couple-home.loading">
              <ActivityIndicator color="#f5f5f5" />
            </View>
          ) : (
            <View style={styles.empty} testID="couple-home.empty">
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptyBody}>
                Save a post, complete a prompt, or finish a loop — your shared ledger lands here.
              </Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
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
    paddingTop: 12,
    paddingBottom: 12,
  },
  back: { color: '#9ec5ff', fontSize: 15 },
  headerTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  headerSpacer: { width: 40 },
  headerBody: { paddingHorizontal: 16, gap: 14 },
  tile: {
    padding: 18,
    backgroundColor: '#161616',
    borderRadius: 12,
    gap: 6,
  },
  tileLabel: { color: '#9e9e9e', fontSize: 13, letterSpacing: 0.5 },
  tileCount: { color: '#f5f5f5', fontSize: 36, fontWeight: '700' },
  tileHint: { color: '#808080', fontSize: 12 },
  shortcuts: { flexDirection: 'row', gap: 10 },
  shortcutButton: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  shortcutText: { color: '#9ec5ff', fontWeight: '600' },
  sectionHeader: {
    color: '#9e9e9e',
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingTop: 8,
  },
  listContent: { paddingBottom: 24 },
  row: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
    backgroundColor: '#161616',
    borderRadius: 10,
    gap: 4,
  },
  rowLabel: { color: '#f5f5f5', fontSize: 14 },
  rowMeta: { color: '#808080', fontSize: 12 },
  empty: { paddingTop: 24, alignItems: 'center', gap: 6, paddingHorizontal: 32 },
  emptyTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  emptyBody: { color: '#808080', fontSize: 13, textAlign: 'center' },
  center: { paddingTop: 32, alignItems: 'center' },
});
