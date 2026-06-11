import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useEffect } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { debugLog } from '../../debug/log-store';
import type { OnboardingParamList } from '../../navigation/OnboardingStack';

export function WelcomeScreen(): JSX.Element {
  const navigation = useNavigation<NavigationProp<OnboardingParamList>>();

  useEffect(() => {
    debugLog('welcome', 'mount');
    return () => debugLog('welcome', 'unmount');
  }, []);

  return (
    <SafeAreaView style={styles.container} testID="screen.welcome">
      <View style={styles.content}>
        <Text style={styles.title}>The Secret Notebook</Text>
        <Text style={styles.subtitle}>For two paired partners.</Text>
        <Text style={styles.body}>
          To start, you'll pair your phone with your partner's over Bluetooth, then jointly choose a
          Safe Word that unlocks the app.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          hitSlop={12}
          onPressIn={() => debugLog('welcome', 'pressIn')}
          onPress={() => {
            debugLog('welcome', 'press → navigate(PairWithPartner)');
            try {
              navigation.navigate('PairWithPartner');
              debugLog('welcome', 'navigate returned');
            } catch (e) {
              const msg = String((e as Error)?.message ?? e);
              debugLog('welcome', `navigate threw: ${msg}`, 'error');
              Alert.alert('Navigation failed', msg);
            }
          }}
          testID="welcome.start"
        >
          <Text style={styles.ctaText}>Start pairing</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '600' },
  subtitle: { color: '#a0a0a0', fontSize: 16 },
  body: { color: '#808080', fontSize: 14, lineHeight: 20, marginTop: 16, marginBottom: 24 },
  cta: { backgroundColor: '#3a3a3a', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  ctaPressed: { backgroundColor: '#5a5a5a' },
  ctaText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
});
