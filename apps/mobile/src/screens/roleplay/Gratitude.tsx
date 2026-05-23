import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface GratitudeProps {
  readonly title: string;
  readonly body: string;
  /** True if I (the actor for this view) have already marked done. */
  readonly mineDone: boolean;
  /** True if the OTHER side has marked done. */
  readonly partnerDone: boolean;
  /** True once both done_at columns are set AND the +25 has landed. */
  readonly loopAwarded: boolean;
  readonly isMarking: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onMarkDone: () => void | Promise<void>;
}

export function Gratitude(props: GratitudeProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.gratitude">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={props.onBack} testID="gratitude.back">
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Gratitude</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.content}>
          <Text style={styles.title} testID="gratitude.title">
            {props.title}
          </Text>
          <Text style={styles.body} testID="gratitude.body">
            {props.body}
          </Text>

          {props.error ? (
            <Text style={styles.errorLine} testID="gratitude.error">
              {props.error}
            </Text>
          ) : null}

          {props.loopAwarded ? (
            <View style={styles.awardBox} testID="gratitude.loop-awarded">
              <Text style={styles.awardLine}>+25 Couple Points · loop closed.</Text>
            </View>
          ) : props.mineDone && props.partnerDone ? (
            <Text style={styles.statusLine} testID="gratitude.both-done">
              Both done. The +25 lands on next sync.
            </Text>
          ) : props.mineDone ? (
            <Text style={styles.statusLine} testID="gratitude.mine-done">
              You marked it done. Waiting for your partner.
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={props.isMarking}
              onPress={props.onMarkDone}
              testID="gratitude.mark-done"
              style={[styles.doneButton, props.isMarking && styles.doneDisabled]}
            >
              {props.isMarking ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.doneText}>I&apos;m done</Text>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { paddingBottom: 32 },
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
  content: { padding: 16, gap: 20 },
  title: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  body: { color: '#e6e6e6', fontSize: 16, lineHeight: 22 },
  doneButton: {
    backgroundColor: '#9ec5ff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  doneDisabled: { backgroundColor: '#2a2a2a' },
  doneText: { color: '#0a0a0a', fontWeight: '700', fontSize: 16 },
  statusLine: { color: '#9e9e9e', fontSize: 14, textAlign: 'center', marginTop: 8 },
  awardBox: {
    marginTop: 8,
    backgroundColor: '#1f2a1f',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  awardLine: { color: '#a8e6a3', fontSize: 14, fontWeight: '600' },
  errorLine: { color: '#ffb4b4', fontSize: 13, textAlign: 'center' },
});
