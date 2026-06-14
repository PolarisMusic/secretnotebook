import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '../../components/ScreenHeader';
import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import {
  getConnectionRoles,
  setMyRole,
  type ConnectionRole,
} from '../../features/connection/role-store';
import { useConnectionStore } from '../../state/connection';
import type { MainStackParamList } from '../../navigation/MainStack';

type Nav = NativeStackNavigationProp<MainStackParamList>;
const ROLES: readonly ConnectionRole[] = ['masculine', 'feminine', 'neutral'];

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Settings home. Houses pairing status (entry into the Pairing modal) and,
 * once paired, the connection role picker — moved here from the retired
 * ConnectionHome. Designed to grow: later phases add media + points-display
 * toggles.
 */
export function SettingsRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const status = useConnectionStore((s) => s.status);
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const paired = status === 'paired';

  const [myRole, setMyRoleState] = useState<ConnectionRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!exec || !engine) return;
    const snap = await getConnectionRoles(exec);
    if (!snap) return;
    const rows = await exec.query<{ partner_a_pubkey: Uint8Array | ArrayBufferLike }>(
      `SELECT partner_a_pubkey FROM connection WHERE id = ?`,
      [snap.connectionId],
    );
    const aRaw = rows[0]?.partner_a_pubkey;
    if (aRaw == null) return;
    const aPub = aRaw instanceof Uint8Array ? aRaw : new Uint8Array(aRaw);
    const isA = sameBytes(engine.selfPub, aPub);
    setMyRoleState(isA ? snap.partnerARole : snap.partnerBRole);
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSetRole = useCallback(
    async (role: ConnectionRole) => {
      if (!exec || !engine) return;
      setBusy(true);
      setError(null);
      try {
        await setMyRole(
          { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
          role,
        );
        await refresh();
      } catch (e) {
        setError((e as Error).message ?? 'Could not save role');
      } finally {
        setBusy(false);
      }
    },
    [exec, engine, refresh],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.settings">
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>PARTNER</Text>
        {paired ? (
          <View style={styles.tile}>
            <Text style={styles.tileText}>Paired ✓</Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            style={styles.cta}
            hitSlop={8}
            onPress={() => navigation.navigate('Pairing')}
            testID="settings.pair"
          >
            <Text style={styles.ctaText}>Pair with a partner</Text>
          </Pressable>
        )}

        {paired && (
          <>
            <Text style={styles.sectionLabel}>MY ROLE</Text>
            <View style={styles.roleRow}>
              {ROLES.map((role) => (
                <Pressable
                  key={role}
                  accessibilityRole="button"
                  disabled={busy}
                  style={[styles.rolePill, myRole === role && styles.rolePillActive]}
                  hitSlop={6}
                  onPress={() => void handleSetRole(role)}
                  testID={`settings.role.${role}`}
                >
                  <Text style={[styles.roleText, myRole === role && styles.roleTextActive]}>
                    {role}
                  </Text>
                </Pressable>
              ))}
            </View>
            {error !== null && <Text style={styles.error}>{error}</Text>}
            <Text style={styles.hint}>
              Your role affects what you see on the global feed (and points display, coming soon).
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  sectionLabel: {
    color: '#7a7a7a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 12,
  },
  tile: { backgroundColor: '#141414', borderRadius: 10, padding: 16 },
  tileText: { color: '#f5f5f5', fontSize: 16 },
  cta: { backgroundColor: '#3a3a3a', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  roleRow: { flexDirection: 'row', gap: 10 },
  rolePill: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  rolePillActive: { backgroundColor: '#9ec5ff' },
  roleText: { color: '#a0a0a0', fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
  roleTextActive: { color: '#0a0a0a' },
  error: { color: '#ff6b6b', fontSize: 14 },
  hint: { color: '#7a7a7a', fontSize: 13, lineHeight: 18, marginTop: 4 },
});
