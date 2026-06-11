import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useEffect } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { debugLog } from '../../debug/log-store';
import type { OnboardingParamList } from '../../navigation/OnboardingStack';

/**
 * Tester-build diagnostic version of the welcome screen. Tries every
 * touchable variant React Native ships so we can see which one (if any)
 * actually receives onPress on the user's device:
 *
 *   - raw `onStartShouldSetResponder` / `onResponderRelease` on a View
 *   - TouchableWithoutFeedback (no styling, just onPress)
 *   - TouchableOpacity (legacy touchable; predates Pressable)
 *   - Pressable (the one currently in the real welcome screen)
 *
 * Each one logs to the debug overlay separately. Combined with the
 * existing `pressIn` / `press` logging this tells us exactly where in
 * the responder chain the tap dies.
 */
export function WelcomeScreen(): JSX.Element {
  const navigation = useNavigation<NavigationProp<OnboardingParamList>>();

  useEffect(() => {
    debugLog('welcome', 'mount');
    return () => debugLog('welcome', 'unmount');
  }, []);

  function navigate(via: string): void {
    debugLog('welcome', `press[${via}] → navigate(PairWithPartner)`);
    try {
      navigation.navigate('PairWithPartner');
      debugLog('welcome', `navigate[${via}] returned`);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      debugLog('welcome', `navigate[${via}] threw: ${msg}`, 'error');
      Alert.alert('Navigation failed', msg);
    }
  }

  return (
    <SafeAreaView
      style={styles.container}
      testID="screen.welcome"
      onStartShouldSetResponder={() => {
        debugLog('welcome', 'safearea.onStartShouldSetResponder');
        return false; // Don't actually capture — just log
      }}
    >
      <View
        style={styles.content}
        onStartShouldSetResponder={() => {
          debugLog('welcome', 'content.onStartShouldSetResponder');
          return false;
        }}
      >
        <Text style={styles.title}>The Secret Notebook</Text>
        <Text style={styles.subtitle}>For two paired partners.</Text>
        <Text style={styles.body}>
          To start, you'll pair your phone with your partner's over Bluetooth, then jointly choose a
          Safe Word that unlocks the app.
        </Text>

        {/* Variant 1: raw responder system on a plain View */}
        <View
          style={[styles.cta, styles.variantA]}
          onStartShouldSetResponder={() => {
            debugLog('welcome', 'A.onStartShouldSetResponder → true');
            return true;
          }}
          onResponderGrant={() => debugLog('welcome', 'A.onResponderGrant')}
          onResponderRelease={() => {
            debugLog('welcome', 'A.onResponderRelease');
            navigate('raw');
          }}
        >
          <Text style={styles.ctaText}>A. Start pairing (raw responder)</Text>
        </View>

        {/* Variant 2: TouchableWithoutFeedback */}
        <TouchableWithoutFeedback
          onPress={() => navigate('twof')}
          onPressIn={() => debugLog('welcome', 'B.pressIn (TWOF)')}
        >
          <View style={[styles.cta, styles.variantB]}>
            <Text style={styles.ctaText}>B. Start pairing (TouchableWithoutFeedback)</Text>
          </View>
        </TouchableWithoutFeedback>

        {/* Variant 3: TouchableOpacity */}
        <TouchableOpacity
          activeOpacity={0.6}
          style={[styles.cta, styles.variantC]}
          onPress={() => navigate('touchable')}
          onPressIn={() => debugLog('welcome', 'C.pressIn (TouchableOpacity)')}
        >
          <Text style={styles.ctaText}>C. Start pairing (TouchableOpacity)</Text>
        </TouchableOpacity>

        {/* Variant 4: Pressable (the original) */}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, styles.variantD, pressed && styles.ctaPressed]}
          hitSlop={12}
          onPressIn={() => debugLog('welcome', 'D.pressIn (Pressable)')}
          onPress={() => navigate('pressable')}
          testID="welcome.start"
        >
          <Text style={styles.ctaText}>D. Start pairing (Pressable)</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  title: { color: '#f5f5f5', fontSize: 24, fontWeight: '600' },
  subtitle: { color: '#a0a0a0', fontSize: 14 },
  body: { color: '#808080', fontSize: 12, lineHeight: 16, marginTop: 8, marginBottom: 12 },
  cta: { paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  variantA: { backgroundColor: '#7a3a3a' }, // red-ish — raw responder
  variantB: { backgroundColor: '#3a7a3a' }, // green — TWOF
  variantC: { backgroundColor: '#3a3a7a' }, // blue — TouchableOpacity
  variantD: { backgroundColor: '#7a7a3a' }, // yellow — Pressable
  ctaPressed: { opacity: 0.6 },
  ctaText: { color: '#f5f5f5', fontSize: 13, fontWeight: '600' },
});
