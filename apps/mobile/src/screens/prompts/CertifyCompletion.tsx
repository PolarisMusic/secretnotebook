import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface CertifyCompletionProps {
  readonly title: string | null;
  readonly body: string | null;
  readonly isLoading: boolean;
  readonly isCertifying: boolean;
  readonly error: string | null;
  readonly alreadyCertified: boolean;
  readonly onCertify: () => void | Promise<void>;
  readonly onBack: () => void;
}

/**
 * Partner-side screen — confirms the assignee actually did the thing.
 * Per the Phase-1 spec, this is the only path that flips the prompt
 * to `certified`. The projector also enforces "only non-assignee can
 * certify" at the SQL guard level, so a misfire from the wrong actor
 * is a silent no-op rather than a corruption.
 */
export function CertifyCompletion(props: CertifyCompletionProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.certify-completion">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={props.onBack}
          testID="certify-completion.back"
        >
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Confirm completion</Text>
        <View style={styles.headerSpacer} />
      </View>

      {props.isLoading && !props.title ? (
        <View style={styles.center} testID="certify-completion.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      ) : null}

      {props.error ? (
        <Text style={styles.errorLine} testID="certify-completion.error">
          {props.error}
        </Text>
      ) : null}

      {props.title ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.preface}>
            Your partner marked this prompt done. Confirm only if you actually saw it happen.
          </Text>
          <Text style={styles.title} testID="certify-completion.title">
            {props.title}
          </Text>
          <Text style={styles.body} testID="certify-completion.body">
            {props.body ?? ''}
          </Text>
          {props.alreadyCertified ? (
            <Text style={styles.certifiedLine} testID="certify-completion.already-certified">
              Certified. Both of you earn Couple Points when S8 wires the ledger.
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={props.isCertifying}
              onPress={props.onCertify}
              testID="certify-completion.certify"
              style={[styles.certifyButton, props.isCertifying && styles.certifyDisabled]}
            >
              {props.isCertifying ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.certifyText}>I confirm they completed it</Text>
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
  preface: { color: '#9e9e9e', fontSize: 13, lineHeight: 18 },
  title: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  body: { color: '#e6e6e6', fontSize: 16, lineHeight: 22 },
  certifiedLine: { color: '#9e9e9e', fontSize: 13, textAlign: 'center', marginTop: 12 },
  certifyButton: {
    backgroundColor: '#9ec5ff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  certifyDisabled: { backgroundColor: '#2a2a2a' },
  certifyText: { color: '#0a0a0a', fontWeight: '700', fontSize: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorLine: {
    color: '#ffb4b4',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 6,
    textAlign: 'center',
  },
});
