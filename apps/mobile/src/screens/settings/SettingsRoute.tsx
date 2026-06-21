import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { bytesToHex } from '@secretnotebook/crypto';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '../../components/ScreenHeader';
import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { getMyRole, setMyRole, type ConnectionRole } from '../../features/connection/role-store';
import { scheduleSever } from '../../features/connection/sever';
import { sumConnectionPoints } from '../../features/ledger/store';
import { getTermState, type SafeWordTermState } from '../../features/safeword/term-store';
import { getPointsVisible, setPointsVisible } from '../../features/settings/points-visibility';
import { useConnectionStore } from '../../state/connection';
import type { MainStackParamList } from '../../navigation/MainStack';

type Nav = NativeStackNavigationProp<MainStackParamList>;
const ROLES: readonly ConnectionRole[] = ['masculine', 'feminine', 'neutral'];

function termSummary(state: SafeWordTermState | null): string {
  switch (state?.kind) {
    case 'set':
      return `Set: ${state.term ?? '••••'}`;
    case 'awaiting_partner':
      return 'Waiting for partner to confirm…';
    case 'incoming_proposal':
      return 'Partner proposed a term — tap to confirm';
    default:
      return 'Not set';
  }
}

/**
 * Settings home. The pairing entry point and the device-local Couple-Points
 * display toggle are always available, so an unpaired user still has settings
 * to adjust. The couple-scoped sections (role, roleplay term, danger zone)
 * need the SyncEngine identity and render only once paired.
 */
export function SettingsRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const status = useConnectionStore((s) => s.status);
  const severAt = useConnectionStore((s) => s.severAt);
  const setSever = useConnectionStore((s) => s.setSever);
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const paired = status === 'paired';

  const [myRole, setMyRoleState] = useState<ConnectionRole | null>(null);
  const [termState, setTermState] = useState<SafeWordTermState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointsVisible, setPointsVisibleState] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec) return;
    // Role + roleplay term are couple-scoped (need the engine identity), so
    // only read them once paired. Couple-Points visibility is device-local
    // KV and works unpaired — the role is simply null then (→ shown by
    // default), so its read lives outside the engine guard.
    let role: ConnectionRole | null = null;
    if (engine) {
      setTermState(await getTermState(exec, engine.selfPub));
      role = await getMyRole(exec, engine.selfPub);
      setMyRoleState(role);
    }
    setPointsVisibleState(await getPointsVisible(exec, role));
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onTerminate = useCallback(async () => {
    if (!exec || !engine) return;
    const points = await sumConnectionPoints(exec);
    Alert.alert(
      'Terminate connection?',
      `You've earned ${points.toLocaleString()} Couple Points together.\n\nThis wipes all shared notes, secrets, and points on both devices after a 7-day grace period — you can undo any time before then.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Terminate',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const at = await scheduleSever({
                  exec,
                  selfPubkey: engine.selfPub,
                  enqueue: (op) => engine.enqueue(op),
                });
                setSever(at, bytesToHex(engine.selfPub));
              } catch (e) {
                Alert.alert('Could not terminate', (e as Error).message);
              }
            })();
          },
        },
      ],
    );
  }, [exec, engine, setSever]);

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

  const onTogglePoints = useCallback(
    async (value: boolean) => {
      if (!exec) return;
      setPointsVisibleState(value); // optimistic; persisted below
      await setPointsVisible(exec, value);
    },
    [exec],
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
              Your role affects what you see on the global feed and the Couple-Points default below.
            </Text>
          </>
        )}

        {/* Always available — device-local KV, no engine required. */}
        <Text style={styles.sectionLabel}>COUPLE POINTS</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.tileText}>Show Couple Points</Text>
          <Switch
            value={pointsVisible}
            onValueChange={(v) => void onTogglePoints(v)}
            testID="settings.points_toggle"
          />
        </View>
        <Text style={styles.hint}>
          Whether the Couple-Points total shows on the Unlock screen. Defaults to your role — hidden
          for the feminine role — and your choice here overrides it on this device.
        </Text>

        {paired && (
          <>
            <Text style={styles.sectionLabel}>ROLEPLAY TERM</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.tile}
              hitSlop={6}
              onPress={() => navigation.navigate('SafeWord')}
              testID="settings.safeword"
            >
              <Text style={styles.tileText}>{termSummary(termState)}</Text>
              <Text style={styles.hint}>
                An optional shared safe word. Tap to set, change, or use it.
              </Text>
            </Pressable>

            <Text style={styles.sectionLabel}>DANGER ZONE</Text>
            {severAt != null ? (
              <View style={styles.tile}>
                <Text style={styles.tileText}>Termination scheduled</Text>
                <Text style={styles.hint}>
                  Manage it from the banner at the top of the screen (undo or end now).
                </Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                style={styles.dangerBtn}
                hitSlop={8}
                onPress={() => void onTerminate()}
                testID="settings.terminate"
              >
                <Text style={styles.dangerText}>Terminate connection</Text>
              </Pressable>
            )}
            <Text style={styles.hint}>
              Ends the pairing and erases all shared data on both devices. Your private device keeps
              nothing of the connection; you can pair again afterward.
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
  toggleRow: {
    backgroundColor: '#141414',
    borderRadius: 10,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
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
  dangerBtn: {
    backgroundColor: '#2a1414',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5a2a2a',
  },
  dangerText: { color: '#ffb4b4', fontSize: 16, fontWeight: '700' },
});
