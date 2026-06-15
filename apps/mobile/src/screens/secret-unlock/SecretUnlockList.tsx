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

import { ScreenHeader } from '../../components/ScreenHeader';

export interface UnlockListItem {
  readonly id: string;
  readonly promptText: string;
  /** One-line status tailored to this device's role + the attempt state. */
  readonly statusLine: string;
  /** True when it's this user's move (drives the highlight + sort to top). */
  readonly needsYou: boolean;
  readonly createdAt: number;
}

export interface SecretUnlockListProps {
  readonly couplePoints: number;
  readonly items: ReadonlyArray<UnlockListItem>;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly paired: boolean;
  /** Whether a new unlock can be started right now. */
  readonly canStart: boolean;
  /** Why start is disabled (shown under the button), or null when enabled. */
  readonly startDisabledReason: string | null;
  readonly onRefresh: () => void;
  readonly onStart: () => void;
  readonly onSelect: (id: string) => void;
}

function isoDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

/**
 * The unlock-loop hub: the couple's running point total up top, a button to
 * start a new unlock against the partner's secret pool, and the list of
 * in-flight + finished attempts (whichever needs your move floats to the
 * top, highlighted).
 */
export function SecretUnlockList(props: SecretUnlockListProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.unlock">
      <ScreenHeader title="Unlock" />

      <View style={styles.pointsCard} testID="unlock.points">
        <Text style={styles.pointsValue}>{props.couplePoints.toLocaleString()}</Text>
        <Text style={styles.pointsLabel}>Couple Points</Text>
      </View>

      {!props.paired && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Pair with your partner to unlock each other's secret notes.
          </Text>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={!props.canStart}
        style={[styles.startBtn, !props.canStart && styles.startBtnDisabled]}
        onPress={props.onStart}
        testID="unlock.start"
      >
        <Text style={[styles.startBtnText, !props.canStart && styles.startBtnTextDisabled]}>
          Start an unlock
        </Text>
      </Pressable>
      {props.startDisabledReason != null && (
        <Text style={styles.startHint} testID="unlock.start_hint">
          {props.startDisabledReason}
        </Text>
      )}

      <FlatList
        data={props.items as UnlockListItem[]}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl
            refreshing={props.isRefreshing}
            onRefresh={props.onRefresh}
            tintColor="#f5f5f5"
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            testID={`unlock.row.${item.id}`}
            onPress={() => props.onSelect(item.id)}
            style={[styles.row, item.needsYou && styles.rowNeedsYou]}
          >
            <View style={styles.rowTopRow}>
              <Text style={[styles.status, item.needsYou && styles.statusNeedsYou]}>
                {item.statusLine}
              </Text>
              {item.needsYou && <Text style={styles.dot}>●</Text>}
            </View>
            <Text style={styles.rowBody} numberOfLines={2}>
              {item.promptText}
            </Text>
            <Text style={styles.rowMeta}>{isoDate(item.createdAt)}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          props.isLoading ? (
            <View style={styles.center} testID="unlock.loading">
              <ActivityIndicator color="#f5f5f5" />
            </View>
          ) : (
            <View style={styles.empty} testID="unlock.empty">
              <Text style={styles.emptyTitle}>No unlocks yet</Text>
              <Text style={styles.emptyBody}>
                Start one to earn the chance to read one of your partner's secret notes.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  pointsCard: {
    backgroundColor: '#161616',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    gap: 2,
  },
  pointsValue: { color: '#9eff9e', fontSize: 34, fontWeight: '800', letterSpacing: 0.5 },
  pointsLabel: { color: '#808080', fontSize: 12, fontWeight: '600', letterSpacing: 1 },
  banner: {
    backgroundColor: '#1c1c2a',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
  },
  bannerText: { color: '#9ec5ff', fontSize: 13, lineHeight: 18 },
  startBtn: {
    backgroundColor: '#2a2a3a',
    marginHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  startBtnDisabled: { backgroundColor: '#161616' },
  startBtnText: { color: '#cdd6ff', fontSize: 16, fontWeight: '700' },
  startBtnTextDisabled: { color: '#5a5a5a' },
  startHint: {
    color: '#808080',
    fontSize: 12,
    marginHorizontal: 16,
    marginTop: 6,
    textAlign: 'center',
  },
  listContent: { padding: 16, paddingTop: 16 },
  row: { backgroundColor: '#161616', padding: 14, borderRadius: 10, marginBottom: 10, gap: 6 },
  rowNeedsYou: { borderWidth: 1, borderColor: '#3a3a5a' },
  rowTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  status: { color: '#9a9a9a', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  statusNeedsYou: { color: '#9ec5ff' },
  dot: { color: '#9ec5ff', fontSize: 10 },
  rowBody: { color: '#f5f5f5', fontSize: 15, lineHeight: 20 },
  rowMeta: { color: '#808080', fontSize: 12 },
  empty: { paddingTop: 60, alignItems: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  emptyBody: { color: '#808080', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  center: { paddingTop: 32, alignItems: 'center' },
});
