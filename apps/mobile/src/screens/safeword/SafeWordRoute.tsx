import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '../../components/ScreenHeader';
import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { isLockedOut, useSafeWordLockout } from '../../features/safeword/lockout';
import {
  confirmTerm,
  getTermState,
  proposeTerm,
  SAFEWORD_TERM_MAX,
  SAFEWORD_TERM_MIN,
  type SafeWordTermState,
  type TermStoreDeps,
} from '../../features/safeword/term-store';
import {
  ackTrigger,
  fireTrigger,
  getActiveTrigger,
  type ActiveTrigger,
  type TriggerStoreDeps,
} from '../../features/safeword/trigger-store';

/**
 * Roleplay term ("Safe Word") management. The term is a shared, mutually-known
 * word — it gates nothing. Setting/changing it is a propose → "type it back to
 * match" handshake; once set, either partner can fire the safe word, which
 * alerts the other until they confirm receipt. Reached from Settings and from
 * the inline prompt when composing a secret note.
 */
export function SafeWordRoute(): JSX.Element {
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const recordFailure = useSafeWordLockout((s) => s.recordFailure);
  const recordSuccess = useSafeWordLockout((s) => s.recordSuccess);
  const lockedUntil = useSafeWordLockout((s) => s.lockedUntil);

  const [state, setState] = useState<SafeWordTermState | null>(null);
  const [active, setActive] = useState<ActiveTrigger | null>(null);
  const [input, setInput] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!exec || !engine) return;
    setState(await getTermState(exec, engine.selfPub));
    setActive(await getActiveTrigger(exec, engine.selfPub));
  }, [exec, engine]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      // Poll so the partner's async confirm / ack surfaces without a manual
      // pull (the sync ticker applies their op in the background).
      const handle = setInterval(() => void refresh(), 5000);
      return () => clearInterval(handle);
    }, [refresh]),
  );

  const termDeps = useCallback((): TermStoreDeps | null => {
    if (!exec || !engine) return null;
    return {
      exec,
      selfPubkey: engine.selfPub,
      connectionRoot: engine.connectionRoot,
      enqueue: (op) => engine.enqueue(op),
    };
  }, [exec, engine]);

  const triggerDeps = useCallback((): TriggerStoreDeps | null => {
    if (!exec || !engine) return null;
    return { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) };
  }, [exec, engine]);

  const handlePropose = useCallback(async () => {
    const deps = termDeps();
    if (!deps) return;
    setBusy(true);
    setError(null);
    try {
      await proposeTerm(deps, input);
      setInput('');
      setChanging(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message ?? 'Could not propose term');
    } finally {
      setBusy(false);
    }
  }, [termDeps, input, refresh]);

  const handleConfirm = useCallback(async () => {
    const deps = termDeps();
    if (!deps) return;
    if (isLockedOut()) {
      setError('Too many attempts — wait a moment and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmTerm(deps, input);
      recordSuccess();
      setInput('');
      await refresh();
    } catch (e) {
      recordFailure();
      setError((e as Error).message ?? 'Could not confirm term');
    } finally {
      setBusy(false);
    }
  }, [termDeps, input, refresh, recordFailure, recordSuccess]);

  const handleTrigger = useCallback(() => {
    const deps = triggerDeps();
    if (!deps) return;
    Alert.alert(
      'Use the safe word?',
      'Your partner will be alerted on their device until they confirm they received it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Use safe word',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                await fireTrigger(deps);
                await refresh();
              } catch (e) {
                setError((e as Error).message ?? 'Could not send the signal');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [triggerDeps, refresh]);

  const handleAck = useCallback(async () => {
    const deps = triggerDeps();
    if (!deps || !active) return;
    setBusy(true);
    try {
      await ackTrigger(deps, active.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [triggerDeps, active, refresh]);

  const locked = lockedUntil != null && isLockedOut();

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.safeword">
      <ScreenHeader title="Roleplay term" />
      <ScrollView contentContainerStyle={styles.content}>
        {!engine ? (
          <Text style={styles.hint}>Pair with a partner to set a shared roleplay term.</Text>
        ) : state == null ? (
          <ActivityIndicator color="#f5f5f5" />
        ) : (
          <>
            {/* Active outbound signal (we fired it). */}
            {active?.direction === 'outbound' && (
              <View style={[styles.tile, styles.alertTile]}>
                <Text style={styles.alertText}>
                  You used the safe word. Waiting for your partner to confirm…
                </Text>
              </View>
            )}
            {/* Active inbound signal (mirrors the global alert; ack here too). */}
            {active?.direction === 'inbound' && (
              <View style={[styles.tile, styles.alertTile]}>
                <Text style={styles.alertText}>Your partner used the safe word.</Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.cta}
                  hitSlop={8}
                  disabled={busy}
                  onPress={() => void handleAck()}
                  testID="safeword.ack"
                >
                  <Text style={styles.ctaText}>Confirm received</Text>
                </Pressable>
              </View>
            )}

            {state.kind === 'incoming_proposal' && (
              <>
                <Text style={styles.sectionLabel}>CONFIRM TERM</Text>
                <Text style={styles.hint}>
                  Your partner proposed a roleplay term. Type it below to confirm you both agree.
                </Text>
                {renderInput()}
                {locked && <Text style={styles.error}>Too many attempts — wait a moment.</Text>}
                {renderPrimary(
                  'Confirm',
                  () => void handleConfirm(),
                  input.trim().length === 0 || locked,
                )}
              </>
            )}

            {state.kind === 'awaiting_partner' && (
              <View style={styles.tile}>
                <Text style={styles.tileText}>
                  Waiting for your partner to confirm
                  {state.term ? ` "${state.term}"` : ' your proposed term'}…
                </Text>
              </View>
            )}

            {state.kind === 'none' && (
              <>
                <Text style={styles.sectionLabel}>SET A TERM</Text>
                <Text style={styles.hint}>
                  Agree on a shared word with your partner. They'll type it back to confirm. It's
                  just for the two of you — nothing is locked behind it.
                </Text>
                {renderInput()}
                {renderPrimary('Propose to partner', () => void handlePropose(), !canPropose())}
              </>
            )}

            {state.kind === 'set' && !changing && (
              <>
                <Text style={styles.sectionLabel}>YOUR TERM</Text>
                <View style={styles.tile}>
                  <Text style={styles.termText}>{state.term ?? '••••'}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  style={styles.secondary}
                  hitSlop={8}
                  onPress={() => {
                    setChanging(true);
                    setInput('');
                    setError(null);
                  }}
                  testID="safeword.change"
                >
                  <Text style={styles.secondaryText}>Change term</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.cta, styles.danger]}
                  hitSlop={8}
                  disabled={busy}
                  onPress={handleTrigger}
                  testID="safeword.trigger"
                >
                  <Text style={styles.ctaText}>Use the safe word</Text>
                </Pressable>
              </>
            )}

            {state.kind === 'set' && changing && (
              <>
                <Text style={styles.sectionLabel}>CHANGE TERM</Text>
                <Text style={styles.hint}>
                  Propose a new word; your current term stays until your partner confirms the new
                  one.
                </Text>
                {renderInput()}
                <View style={styles.row}>
                  {renderPrimary('Propose', () => void handlePropose(), !canPropose())}
                  <Pressable
                    accessibilityRole="button"
                    style={styles.secondary}
                    hitSlop={8}
                    onPress={() => {
                      setChanging(false);
                      setInput('');
                      setError(null);
                    }}
                    testID="safeword.cancel-change"
                  >
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                </View>
              </>
            )}

            {error != null && <Text style={styles.error}>{error}</Text>}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );

  function canPropose(): boolean {
    const n = input.trim().length;
    return !busy && n >= SAFEWORD_TERM_MIN && n <= SAFEWORD_TERM_MAX;
  }

  function renderInput(): JSX.Element {
    return (
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder={`${SAFEWORD_TERM_MIN}–${SAFEWORD_TERM_MAX} characters`}
        placeholderTextColor="#666"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        maxLength={SAFEWORD_TERM_MAX}
        style={styles.input}
        testID="safeword.input"
      />
    );
  }

  function renderPrimary(label: string, onPress: () => void, disabled: boolean): JSX.Element {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        style={[styles.cta, disabled && styles.ctaDisabled]}
        hitSlop={8}
        onPress={onPress}
        testID="safeword.submit"
      >
        {busy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.ctaText}>{label}</Text>}
      </Pressable>
    );
  }
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
  hint: { color: '#9e9e9e', fontSize: 14, lineHeight: 20 },
  tile: { backgroundColor: '#141414', borderRadius: 10, padding: 16, gap: 12 },
  tileText: { color: '#f5f5f5', fontSize: 16, lineHeight: 22 },
  termText: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  alertTile: { backgroundColor: '#2a1414', borderWidth: 1, borderColor: '#7a2a2a' },
  alertText: { color: '#ffd4d4', fontSize: 16, lineHeight: 22 },
  input: {
    backgroundColor: '#161616',
    color: '#f5f5f5',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 10,
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  cta: {
    backgroundColor: '#9ec5ff',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#2a2a2a' },
  ctaText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
  danger: { backgroundColor: '#e06a6a' },
  secondary: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  secondaryText: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  error: { color: '#ff6b6b', fontSize: 14 },
});
