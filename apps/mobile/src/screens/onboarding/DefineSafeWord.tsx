import { useState } from 'react';
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

export interface DefineSafeWordProps {
  /** Called when both fields match and the user submits. The container
   *  is responsible for deriving the Argon2id material, writing the
   *  connection row, and advancing navigation. Resolve to display an error
   *  message; reject to leave the user on the screen with the input
   *  intact. */
  readonly onSubmit: (safeword: string) => Promise<string | null>;
}

const MIN_LENGTH = 4;
const MAX_LENGTH = 64;

export function DefineSafeWord(props: DefineSafeWordProps): JSX.Element {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = first.length > 0 && first.length < MIN_LENGTH;
  const tooLong = first.length > MAX_LENGTH;
  const mismatch = second.length > 0 && first !== second;
  const canSubmit =
    !busy && first.length >= MIN_LENGTH && first.length <= MAX_LENGTH && first === second;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const errMessage = await props.onSubmit(first);
      if (errMessage) setError(errMessage);
    } catch (e) {
      setError((e as Error).message ?? 'Could not save Safe Word');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.define_safeword">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.title}>Choose your Safe Word</Text>
          <Text style={styles.body}>
            Both partners type the same word. You'll re-enter it on every cold launch and after a
            minute in the background. It never leaves either device.
          </Text>
          <TextInput
            style={styles.input}
            value={first}
            onChangeText={setFirst}
            placeholder="Safe Word"
            placeholderTextColor="#606060"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            testID="safeword.first"
          />
          <TextInput
            style={styles.input}
            value={second}
            onChangeText={setSecond}
            placeholder="Type it again to confirm"
            placeholderTextColor="#606060"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            testID="safeword.second"
          />
          {tooShort && <Text style={styles.hint}>At least {MIN_LENGTH} characters.</Text>}
          {tooLong && <Text style={styles.hint}>At most {MAX_LENGTH} characters.</Text>}
          {mismatch && <Text style={styles.hint}>The two entries don't match.</Text>}
          {error && (
            <Text style={styles.error} testID="safeword.error">
              {error}
            </Text>
          )}
          <Pressable
            style={[styles.cta, !canSubmit && styles.ctaDisabled]}
            disabled={!canSubmit}
            onPress={submit}
            testID="safeword.submit"
          >
            {busy ? <ActivityIndicator /> : <Text style={styles.ctaText}>Save Safe Word</Text>}
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
  title: { color: '#f5f5f5', fontSize: 24, fontWeight: '600' },
  body: { color: '#a0a0a0', fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#f5f5f5',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  hint: { color: '#a0a0a0', fontSize: 13 },
  error: { color: '#ff6b6b', fontSize: 14 },
  cta: {
    backgroundColor: '#3a3a3a',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
});
