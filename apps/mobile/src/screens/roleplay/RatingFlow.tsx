import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface RatingFlowProps {
  readonly isSubmitting: boolean;
  readonly error: string | null;
  /** If non-null, the rating has already been recorded; the screen
   *  collapses to a read-only confirmation. */
  readonly existingRating: number | null;
  readonly onBack: () => void;
  readonly onSubmit: (rating: number) => void | Promise<void>;
}

const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * Curator-only screen: a 1..10 chip row + Submit. The rating is
 * private to the couple — the projector enforces "only the curator
 * can rate" at the SQL layer, so a misfire from the wrong actor is
 * a silent no-op. Phase-1 spec explicitly says the rating "never
 * leaves the couple channel, never on API/chain".
 */
export function RatingFlow(props: RatingFlowProps): JSX.Element {
  const [picked, setPicked] = useState<number | null>(props.existingRating);
  const canSubmit = !props.isSubmitting && picked != null && props.existingRating == null;

  return (
    <SafeAreaView style={styles.container} testID="screen.rating-flow">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="rating-flow.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Private rating</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <Text style={styles.preface}>
          A private 1–10 rating of the moment — for the two of you only. It never leaves your
          phones.
        </Text>

        <View style={styles.scale}>
          {SCALE.map((n) => {
            const selected = picked === n;
            const disabled = props.isSubmitting || props.existingRating != null;
            return (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                disabled={disabled}
                testID={`rating-flow.chip.${n}`}
                onPress={() => setPicked(n)}
                style={[styles.chip, selected && styles.chipActive]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>

        {props.error ? (
          <Text style={styles.errorLine} testID="rating-flow.error">
            {props.error}
          </Text>
        ) : null}

        {props.existingRating != null ? (
          <Text style={styles.donelLine} testID="rating-flow.already-rated">
            You already rated this moment — {props.existingRating}/10.
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={() => picked != null && void props.onSubmit(picked)}
            testID="rating-flow.submit"
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
          >
            {props.isSubmitting ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.submitText}>Submit rating</Text>
            )}
          </Pressable>
        )}
      </View>
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
  content: { padding: 16, gap: 24 },
  preface: { color: '#9e9e9e', fontSize: 13, lineHeight: 18 },
  scale: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  chip: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
  },
  chipActive: { backgroundColor: '#9ec5ff' },
  chipText: { color: '#9e9e9e', fontSize: 16, fontWeight: '600' },
  chipTextActive: { color: '#0a0a0a' },
  submit: {
    backgroundColor: '#9ec5ff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submitDisabled: { backgroundColor: '#2a2a2a' },
  submitText: { color: '#0a0a0a', fontWeight: '700', fontSize: 16 },
  errorLine: { color: '#ffb4b4', fontSize: 13, textAlign: 'center' },
  donelLine: { color: '#9e9e9e', fontSize: 13, textAlign: 'center' },
});
