import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface AppLockGateProps {
  /** Trigger the biometric prompt. The route owns the actual unlock + session. */
  readonly onUnlock: () => void;
  readonly busy: boolean;
  readonly error: string | null;
}

/**
 * Biometric app-open lock. Auto-prompts once on mount; if the user cancels
 * or it fails, they get a tap-to-retry button. This is a privacy gate, not
 * the Safe Word.
 */
export function AppLockGate(props: AppLockGateProps): JSX.Element {
  // Prompt exactly once on mount (onUnlock is a fresh closure each render,
  // so guard with a ref); retries after that are manual via the button.
  const { onUnlock } = props;
  const prompted = useRef(false);
  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    onUnlock();
  }, [onUnlock]);

  return (
    <SafeAreaView style={styles.container} testID="screen.app_lock">
      <View style={styles.content}>
        <Text style={styles.title}>Locked</Text>
        <Text style={styles.body}>Unlock with Face ID to open your notes.</Text>
        {props.error !== null && <Text style={styles.error}>{props.error}</Text>}
        <Pressable
          accessibilityRole="button"
          style={styles.cta}
          onPress={props.onUnlock}
          disabled={props.busy}
          hitSlop={8}
          testID="applock.unlock"
        >
          {props.busy ? <ActivityIndicator /> : <Text style={styles.ctaText}>Unlock</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '600' },
  body: { color: '#a0a0a0', fontSize: 14, lineHeight: 20 },
  error: { color: '#ff6b6b', fontSize: 14 },
  cta: {
    backgroundColor: '#3a3a3a',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
});
