import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface ActivePromptProps {
  readonly title: string | null;
  readonly body: string | null;
  readonly isLoading: boolean;
  readonly isMarkingDone: boolean;
  readonly error: string | null;
  /** True once the user has already marked done — button collapses to a
   *  "waiting for partner to certify" line. */
  readonly alreadyDone: boolean;
  readonly onMarkDone: () => void | Promise<void>;
  readonly onBack: () => void;
}

export function ActivePrompt(props: ActivePromptProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.active-prompt">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="active-prompt.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Your prompt</Text>
        <View style={styles.headerSpacer} />
      </View>

      {props.isLoading && !props.title ? (
        <View style={styles.center} testID="active-prompt.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      ) : null}

      {props.error ? (
        <Text style={styles.errorLine} testID="active-prompt.error">
          {props.error}
        </Text>
      ) : null}

      {props.title ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title} testID="active-prompt.title">
            {props.title}
          </Text>
          <Text style={styles.body} testID="active-prompt.body">
            {props.body ?? ''}
          </Text>
          {props.alreadyDone ? (
            <Text style={styles.waitingLine} testID="active-prompt.waiting">
              You marked this done. Waiting for your partner to certify.
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={props.isMarkingDone}
              onPress={props.onMarkDone}
              testID="active-prompt.mark-done"
              style={[styles.doneButton, props.isMarkingDone && styles.doneDisabled]}
            >
              {props.isMarkingDone ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.doneText}>I did it</Text>
              )}
            </Pressable>
          )}
        </ScrollView>
      ) : null}
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
  content: { padding: 16, gap: 20 },
  title: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  body: { color: '#e6e6e6', fontSize: 16, lineHeight: 22 },
  waitingLine: { color: '#9e9e9e', fontSize: 13, marginTop: 12, textAlign: 'center' },
  doneButton: {
    backgroundColor: '#9ec5ff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  doneDisabled: { backgroundColor: '#2a2a2a' },
  doneText: { color: '#0a0a0a', fontWeight: '700', fontSize: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorLine: {
    color: '#ffb4b4',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 6,
    textAlign: 'center',
  },
});
