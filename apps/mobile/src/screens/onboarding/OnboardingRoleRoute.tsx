import { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { getMyRole, setMyRole, type ConnectionRole } from '../../features/connection/role-store';
import type { MainStackParamList } from '../../navigation/MainStack';

type Nav = NativeStackNavigationProp<MainStackParamList>;

const ROLES: readonly { value: ConnectionRole; label: string }[] = [
  { value: 'masculine', label: 'Masculine' },
  { value: 'feminine', label: 'Feminine' },
  { value: 'neutral', label: 'Neutral' },
];

export function OnboardingRoleRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [selected, setSelected] = useState<ConnectionRole | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!exec || !engine) return;
    let cancelled = false;
    void getMyRole(exec, engine.selfPub).then((role) => {
      if (!cancelled && role != null) setSelected(role);
    });
    return () => {
      cancelled = true;
    };
  }, [exec, engine]);

  const goNext = useCallback(() => {
    navigation.navigate('OnboardingCategories');
  }, [navigation]);

  const onContinue = useCallback(async () => {
    if (busy) return;
    if (selected === null || !exec || !engine) {
      goNext();
      return;
    }
    setBusy(true);
    try {
      await setMyRole(
        { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
        selected,
      );
    } finally {
      setBusy(false);
      goNext();
    }
  }, [busy, selected, exec, engine, goNext]);

  return (
    <SafeAreaView style={styles.container} testID="screen.onboarding-role">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>Step 1 of 3</Text>
        <Text style={styles.title}>Your role</Text>
        <Text style={styles.body}>
          Controls the default view of the public feed and certain UI settings. All other settings
          can be changed independently of this at any time.
        </Text>

        <View style={styles.roles}>
          {ROLES.map(({ value, label }) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === value }}
              onPress={() => setSelected(value)}
              style={[styles.roleBtn, selected === value && styles.roleBtnActive]}
              testID={`onboarding-role.${value}`}
            >
              <Text style={[styles.roleBtnText, selected === value && styles.roleBtnTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void onContinue()}
          style={[styles.cta, busy && styles.ctaDisabled]}
          testID="onboarding-role.continue"
        >
          {busy ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.ctaText}>{selected !== null ? 'Continue' : 'Skip'}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, gap: 16, flexGrow: 1 },
  step: { color: '#5a5a5a', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '700', lineHeight: 34 },
  body: { color: '#9e9e9e', fontSize: 15, lineHeight: 22, marginTop: 4 },
  roles: { marginTop: 16, gap: 12 },
  roleBtn: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#161616',
    borderWidth: 1.5,
    borderColor: '#2a2a2a',
  },
  roleBtnActive: { borderColor: '#9ec5ff', backgroundColor: '#0d1a2a' },
  roleBtnText: { color: '#b0b0b0', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  roleBtnTextActive: { color: '#9ec5ff' },
  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 12 },
  cta: {
    backgroundColor: '#9ec5ff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#2a2a2a' },
  ctaText: { color: '#0a0a0a', fontSize: 17, fontWeight: '700' },
});
