import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBootStore } from '../../features/boot/store';

export interface BootScreenProps {
  readonly onRetry: () => void;
}

export function BootScreen(props: BootScreenProps): JSX.Element {
  const phase = useBootStore((s) => s.phase);
  const error = useBootStore((s) => s.error);

  return (
    <SafeAreaView style={styles.container} testID="screen.boot">
      <View style={styles.content}>
        {phase === 'error' ? (
          <>
            <Text style={styles.title}>Couldn't open your notebook</Text>
            <Text style={styles.error} testID="boot.error">
              {error ?? 'Unknown error'}
            </Text>
            <Pressable style={styles.cta} onPress={props.onRetry} testID="boot.retry">
              <Text style={styles.ctaText}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text style={styles.body}>Unlocking…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  title: { color: '#f5f5f5', fontSize: 22, fontWeight: '600', textAlign: 'center' },
  body: { color: '#a0a0a0', fontSize: 14 },
  error: { color: '#ff6b6b', fontSize: 14, textAlign: 'center' },
  cta: { backgroundColor: '#3a3a3a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8 },
  ctaText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
});
