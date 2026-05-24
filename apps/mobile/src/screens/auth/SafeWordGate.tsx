import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface SafeWordGateProps {
  /** Verify the candidate. Resolve true to unlock; false to count as a
   *  failed attempt (caller is responsible for incrementing the lockout
   *  store). */
  readonly verify: (candidate: string) => Promise<boolean>;
  /** Milliseconds the user must still wait before retrying, or 0 if
   *  attempts are allowed right now. Re-read on every render. */
  readonly lockoutRemainingMs: () => number;
  /** Called once verification succeeds. The route is responsible for
   *  satisfying the session and routing forward. */
  readonly onUnlocked: () => void;
}

export function SafeWordGate(props: SafeWordGateProps): JSX.Element {
  const [candidate, setCandidate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(props.lockoutRemainingMs());

  // Tick once a second to update the lockout countdown.
  useEffect(() => {
    const tick = () => setRemaining(props.lockoutRemainingMs());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [props]);

  const locked = remaining > 0;

  async function submit() {
    if (busy || locked || candidate.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await props.verify(candidate);
      if (ok) {
        props.onUnlocked();
        setCandidate('');
      } else {
        setError('Wrong Safe Word.');
        setRemaining(props.lockoutRemainingMs());
      }
    } catch (e) {
      setError((e as Error).message ?? 'Could not verify');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.safeword_gate">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.title}>Safe Word</Text>
          <Text style={styles.body}>Type it to unlock your connection notebook.</Text>
          <TextInput
            style={styles.input}
            value={candidate}
            onChangeText={setCandidate}
            placeholder="Safe Word"
            placeholderTextColor="#606060"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!locked}
            onSubmitEditing={submit}
            returnKeyType="go"
            testID="gate.input"
          />
          {error && !locked && (
            <Text style={styles.error} testID="gate.error">
              {error}
            </Text>
          )}
          {locked && (
            <Text style={styles.locked} testID="gate.locked">
              Locked for {Math.ceil(remaining / 1000)}s.
            </Text>
          )}
          <Pressable
            style={[styles.cta, (busy || locked || candidate.length === 0) && styles.ctaDisabled]}
            disabled={busy || locked || candidate.length === 0}
            onPress={submit}
            testID="gate.submit"
          >
            {busy ? <ActivityIndicator /> : <Text style={styles.ctaText}>Unlock</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '600' },
  body: { color: '#a0a0a0', fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#f5f5f5',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  error: { color: '#ff6b6b', fontSize: 14 },
  locked: { color: '#ffaa55', fontSize: 14 },
  cta: {
    backgroundColor: '#3a3a3a',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
});
