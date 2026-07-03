import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '../../components/ScreenHeader';
import { BADGE_MILESTONES, nextBadge } from '../../features/ledger/badges';

export interface BadgesScreenProps {
  readonly totalPoints: number;
}

/**
 * Milestone gallery for the couple's Sparks total. Earned badges show in
 * full colour; locked ones are dimmed. The next badge shows how many Sparks
 * remain. Purely a read-only celebration surface — reached from the menu.
 */
export function BadgesScreen(props: BadgesScreenProps): JSX.Element {
  const total = props.totalPoints;
  const upcoming = nextBadge(total);
  const earnedCount = BADGE_MILESTONES.filter((b) => total >= b.threshold).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.badges">
      <ScreenHeader title="Badges" />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summary} testID="badges.summary">
          <Text style={styles.summaryValue}>{total.toLocaleString()}</Text>
          <Text style={styles.summaryLabel}>SPARKS</Text>
          <Text style={styles.summaryCount}>
            {earnedCount} of {BADGE_MILESTONES.length} badges earned
          </Text>
        </View>

        {BADGE_MILESTONES.map((b) => {
          const earned = total >= b.threshold;
          const isNext = upcoming?.threshold === b.threshold;
          const remaining = Math.max(0, b.threshold - total);
          return (
            <View
              key={b.threshold}
              style={[styles.row, earned ? styles.rowEarned : styles.rowLocked]}
              testID={`badges.row.${b.threshold}`}
            >
              <Text style={[styles.emoji, !earned && styles.emojiLocked]}>{b.emoji}</Text>
              <View style={styles.rowText}>
                <Text style={[styles.name, !earned && styles.nameLocked]}>{b.name}</Text>
                <Text style={styles.meta}>
                  {earned
                    ? `Earned · ${b.threshold.toLocaleString()} Sparks`
                    : isNext
                      ? `${remaining.toLocaleString()} Sparks to go`
                      : `${b.threshold.toLocaleString()} Sparks`}
                </Text>
              </View>
              {earned ? (
                <Text style={styles.check} testID={`badges.row.${b.threshold}.earned`}>
                  ✓
                </Text>
              ) : (
                <Text style={styles.lock}>🔒</Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  summary: {
    backgroundColor: '#161616',
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: 'center',
    marginBottom: 6,
  },
  summaryValue: { color: '#9eff9e', fontSize: 34, fontWeight: '800', letterSpacing: 0.5 },
  summaryLabel: { color: '#808080', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  summaryCount: { color: '#b5b5b5', fontSize: 13, marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 14,
  },
  rowEarned: { borderWidth: 1, borderColor: '#2f3a2f' },
  rowLocked: { opacity: 0.55 },
  emoji: { fontSize: 30 },
  emojiLocked: { opacity: 0.5 },
  rowText: { flex: 1, gap: 3 },
  name: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  nameLocked: { color: '#c8c8c8' },
  meta: { color: '#8a8a8a', fontSize: 12 },
  check: { color: '#9eff9e', fontSize: 20, fontWeight: '800' },
  lock: { fontSize: 16 },
});
