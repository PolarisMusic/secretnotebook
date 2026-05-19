import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, View } from 'react-native';

export function WelcomeScreen(): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.welcome">
      <View style={styles.content}>
        <Text style={styles.title}>The Secret Notebook</Text>
        <Text style={styles.subtitle}>For two paired partners.</Text>
        <Text style={styles.body}>
          Pairing flow lands in S1. This screen is the F3 placeholder so the navigation tree and
          state-driven Onboarding/Main switch can be exercised end-to-end.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '600' },
  subtitle: { color: '#a0a0a0', fontSize: 16 },
  body: { color: '#808080', fontSize: 14, lineHeight: 20, marginTop: 16 },
});
