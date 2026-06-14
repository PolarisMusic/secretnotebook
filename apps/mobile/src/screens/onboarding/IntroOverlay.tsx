import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface IntroOverlayProps {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}

/**
 * One-time welcome shown over the Notes home on first launch. Explains the
 * app in a sentence and is dismissible immediately — it never blocks getting
 * to notes. "Seen" state is persisted in app_setting so it shows once.
 */
export function IntroOverlay(props: IntroOverlayProps): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onDismiss}>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Welcome</Text>
          <Text style={styles.body}>
            Private notes, just for the two of you. Write a note any time — pair with your partner
            when you're ready to share. Everything between you is end-to-end encrypted.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.cta}
            hitSlop={8}
            onPress={props.onDismiss}
            testID="intro.dismiss"
          >
            <Text style={styles.ctaText}>Get started</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: { backgroundColor: '#161616', borderRadius: 16, padding: 24, gap: 16 },
  title: { color: '#f5f5f5', fontSize: 26, fontWeight: '700' },
  body: { color: '#c0c0c0', fontSize: 15, lineHeight: 22 },
  cta: {
    backgroundColor: '#9ec5ff',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  ctaText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
});
