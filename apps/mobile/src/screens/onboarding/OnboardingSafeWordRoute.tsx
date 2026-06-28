import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MainStackParamList } from '../../navigation/MainStack';

type Nav = NativeStackNavigationProp<MainStackParamList>;

export function OnboardingSafeWordRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();

  return (
    <SafeAreaView style={styles.container} testID="screen.onboarding-safeword">
      <View style={styles.content}>
        <Text style={styles.step}>Step 3 of 3</Text>
        <Text style={styles.title}>Safe Word</Text>
        <Text style={styles.body}>
          A Safe Word is a distinctive word or phrase — one you wouldn't typically use with each
          other. Either partner can say it at any time to pause a Prompts session or signal they
          need a break. Setting it requires both of you to confirm.
        </Text>
        <Text style={styles.hint}>You can also set this later from Settings → Safe Word.</Text>
      </View>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('SafeWord')}
          style={styles.cta}
          testID="onboarding-safeword.set"
        >
          <Text style={styles.ctaText}>Set one now</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('NotesList')}
          style={styles.skip}
          testID="onboarding-safeword.skip"
        >
          <Text style={styles.skipText}>Continue to my notebook</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  step: { color: '#5a5a5a', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '700', lineHeight: 34 },
  body: { color: '#9e9e9e', fontSize: 15, lineHeight: 22, marginTop: 4 },
  hint: { color: '#5a5a5a', fontSize: 13, lineHeight: 18, marginTop: 8 },
  footer: { paddingHorizontal: 24, paddingBottom: 24, gap: 12 },
  cta: {
    backgroundColor: '#9ec5ff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: { color: '#0a0a0a', fontSize: 17, fontWeight: '700' },
  skip: { paddingVertical: 12, alignItems: 'center' },
  skipText: { color: '#6a6a6a', fontSize: 15, fontWeight: '600' },
});
