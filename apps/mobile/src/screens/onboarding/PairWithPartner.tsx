import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PairingTransport } from '@secretnotebook/couple-protocol';
import { generateX25519KeyPair } from '@secretnotebook/crypto';

import type { BiometricPrompt } from '../../features/pairing/biometric';
import {
  runPairing,
  type PairingHooks,
  type PairingRun,
} from '../../features/pairing/orchestrator';
import type { PairingState, SelfKeys } from '../../features/pairing/state-machine';
import { useCoupleStore } from '../../state/couple';

export interface PairWithPartnerProps {
  /** Transport factory — injected so the screen has no compile-time
   *  dependency on either MockTransport (dev/tests) or BLE (prod). */
  readonly transportFactory: () => PairingTransport;
  readonly biometric: BiometricPrompt;
  /** Called once both sides reach safeword_required with the matching
   *  root_key. The caller is responsible for writing the couple row,
   *  updating the couple-status store, and advancing to S2. */
  readonly onPaired: (result: {
    rootKey: Uint8Array;
    selfPub: Uint8Array;
    peerPub: Uint8Array;
  }) => Promise<void>;
}

export function PairWithPartner(props: PairWithPartnerProps): JSX.Element {
  const [state, setState] = useState<PairingState>({ name: 'idle' });
  const runRef = useRef<PairingRun | null>(null);
  const setCoupleStatus = useCoupleStore((s) => s.setStatus);

  useEffect(() => {
    return () => {
      runRef.current?.cancel();
    };
  }, []);

  const hooks = useMemo<PairingHooks>(
    () => ({
      async confirmCode(code) {
        const ok = await props.biometric.authenticate(
          `Confirm the code shown on both devices: ${code}`,
        );
        return ok.ok;
      },
    }),
    [props.biometric],
  );

  async function startPairing() {
    setState({ name: 'idle' });
    const identity = await generateX25519KeyPair();
    const ephemeral = await generateX25519KeyPair();
    const selfKeys: SelfKeys = {
      identityPub: identity.publicKey,
      identityPriv: identity.privateKey,
      ephemeralPub: ephemeral.publicKey,
      ephemeralPriv: ephemeral.privateKey,
    };

    const run = runPairing({
      transport: props.transportFactory(),
      hooks,
      selfKeys,
      onTransition: (next) => setState(next),
    });
    runRef.current = run;

    const final = await run.result;
    if (final.name === 'safeword_required') {
      await props.onPaired({
        rootKey: final.rootKey,
        selfPub: selfKeys.identityPub,
        peerPub: final.peerKeys.identityPub,
      });
      setCoupleStatus('awaiting_safeword');
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.pair">
      <View style={styles.content}>
        <Text style={styles.title}>Pair with your partner</Text>
        {state.name === 'idle' && (
          <>
            <Text style={styles.body}>
              Both phones need to be open to this screen. Keep them close together.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.cta}
              onPress={startPairing}
              testID="pair.start"
            >
              <Text style={styles.ctaText}>Start pairing</Text>
            </Pressable>
          </>
        )}
        {state.name === 'scanning' && (
          <>
            <ActivityIndicator />
            <Text style={styles.body}>Looking for your partner's phone…</Text>
          </>
        )}
        {state.name === 'code_shown' && (
          <>
            <Text style={styles.codeLabel}>Make sure this code matches on both phones</Text>
            <Text style={styles.code} testID="pair.code">
              {state.code}
            </Text>
            <Text style={styles.body}>You'll be asked to confirm with biometrics.</Text>
          </>
        )}
        {state.name === 'biometric' && (
          <>
            <ActivityIndicator />
            <Text style={styles.body}>Confirming…</Text>
          </>
        )}
        {state.name === 'handshake' && (
          <>
            <ActivityIndicator />
            <Text style={styles.body}>Setting up your couple channel…</Text>
          </>
        )}
        {state.name === 'safeword_required' && (
          <Text style={styles.body} testID="pair.done">
            Paired. Next, define your Safe Word.
          </Text>
        )}
        {state.name === 'error' && (
          <>
            <Text style={styles.error}>{state.reason}</Text>
            <Pressable style={styles.cta} onPress={startPairing} testID="pair.retry">
              <Text style={styles.ctaText}>Try again</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  title: { color: '#f5f5f5', fontSize: 24, fontWeight: '600' },
  body: { color: '#a0a0a0', fontSize: 14, lineHeight: 20 },
  codeLabel: { color: '#a0a0a0', fontSize: 14 },
  code: {
    color: '#f5f5f5',
    fontSize: 48,
    fontWeight: '600',
    letterSpacing: 8,
    textAlign: 'center',
    marginVertical: 16,
  },
  cta: {
    backgroundColor: '#3a3a3a',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  error: { color: '#ff6b6b', fontSize: 14 },
});
