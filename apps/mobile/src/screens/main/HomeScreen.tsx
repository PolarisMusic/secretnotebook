import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, View } from 'react-native';

export function HomeScreen(): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.home">
      <View style={styles.content}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.body}>
          You're paired. The global feed, prompts, and saved-posts views land in S3 / S5 / S6.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  title: { color: '#f5f5f5', fontSize: 24, fontWeight: '600' },
  body: { color: '#808080', fontSize: 14, lineHeight: 20 },
});
