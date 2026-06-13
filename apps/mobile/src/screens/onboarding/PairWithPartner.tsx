import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { generateX25519KeyPair } from '@secretnotebook/crypto';

import type { BiometricPrompt } from '../../features/pairing/biometric';
import {
  runPairing,
  type PairingHooks,
  type PairingRun,
} from '../../features/pairing/orchestrator';
import { QrTransport } from '../../features/pairing/qr-transport';
import { RelayTransport } from '../../features/pairing/relay-transport';
import type { PairingState, SelfKeys } from '../../features/pairing/state-machine';

type Mode = 'choose' | 'qr' | 'relay';

const RELAY_CODE_RE = /^[a-z0-9-]{6,16}$/i;

export interface PairWithPartnerProps {
  /** Base URL for the API server (used by the relay transport). */
  readonly apiBaseUrl: string;
  readonly biometric: BiometricPrompt;
  /** Called once both sides reach safeword_required with the matching
   *  root_key. The caller is responsible for writing the connection row,
   *  updating the connection-status store, and advancing to S2. */
  readonly onPaired: (result: {
    rootKey: Uint8Array;
    selfPub: Uint8Array;
    peerPub: Uint8Array;
  }) => Promise<void>;
}

export function PairWithPartner(props: PairWithPartnerProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('choose');
  const [state, setState] = useState<PairingState>({ name: 'idle' });

  // QR-mode state.
  const [selfQr, setSelfQr] = useState<string | null>(null);
  const qrTransportRef = useRef<QrTransport | null>(null);
  const scanLockRef = useRef(false);

  // Relay-mode state.
  const [relayCode, setRelayCode] = useState('');
  const [relayConnecting, setRelayConnecting] = useState(false);

  const runRef = useRef<PairingRun | null>(null);

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

  async function startQrPairing(): Promise<void> {
    setMode('qr');
    setState({ name: 'idle' });
    setSelfQr(null);
    scanLockRef.current = false;

    const transport = new QrTransport();
    qrTransportRef.current = transport;
    transport.onSelfHelloChange((serialized) => setSelfQr(serialized));

    const selfKeys = await generateSelfKeys();
    const run = runPairing({
      transport,
      hooks,
      selfKeys,
      onTransition: (next) => setState(next),
    });
    runRef.current = run;

    const final = await run.result;
    await maybeFinishPairing(final, selfKeys);
  }

  function pickRelayMode(): void {
    setMode('relay');
    setState({ name: 'idle' });
  }

  async function connectRelay(): Promise<void> {
    const code = relayCode.trim().toLowerCase();
    if (!RELAY_CODE_RE.test(code)) {
      setState({ name: 'error', reason: 'Code must be 6–16 letters, digits, or dashes.' });
      return;
    }
    setRelayConnecting(true);
    setState({ name: 'idle' });

    const transport = new RelayTransport({ code, baseUrl: props.apiBaseUrl });
    const selfKeys = await generateSelfKeys();
    const run = runPairing({
      transport,
      hooks,
      selfKeys,
      onTransition: (next) => setState(next),
    });
    runRef.current = run;

    const final = await run.result;
    setRelayConnecting(false);
    await maybeFinishPairing(final, selfKeys);
  }

  async function maybeFinishPairing(final: PairingState, selfKeys: SelfKeys): Promise<void> {
    if (final.name === 'safeword_required') {
      await props.onPaired({
        rootKey: final.rootKey,
        selfPub: selfKeys.identityPub,
        peerPub: final.peerKeys.identityPub,
      });
    }
  }

  function cancelAndReset(): void {
    runRef.current?.cancel();
    runRef.current = null;
    qrTransportRef.current = null;
    setSelfQr(null);
    setRelayCode('');
    setRelayConnecting(false);
    setState({ name: 'idle' });
    setMode('choose');
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.pair">
      <View style={styles.content}>
        <Text style={styles.title}>Pair with your partner</Text>

        {mode === 'choose' && state.name === 'idle' && (
          <ChooseMode onPickQr={startQrPairing} onPickRelay={pickRelayMode} />
        )}

        {mode === 'qr' &&
          (state.name === 'idle' || state.name === 'scanning') &&
          (selfQr === null ? (
            <Text style={styles.body}>Preparing your pairing QR…</Text>
          ) : (
            <QrPhase
              selfQr={selfQr}
              onScanned={(text) => {
                if (scanLockRef.current) return;
                scanLockRef.current = true;
                qrTransportRef.current?.injectScannedHello(text);
              }}
              onCancel={cancelAndReset}
            />
          ))}

        {mode === 'relay' && state.name === 'idle' && !relayConnecting && (
          <RelayCodePhase
            value={relayCode}
            onChange={setRelayCode}
            onConnect={connectRelay}
            onCancel={cancelAndReset}
          />
        )}

        {mode === 'relay' &&
          relayConnecting &&
          (state.name === 'idle' || state.name === 'scanning') && (
            <>
              <ActivityIndicator />
              <Text style={styles.body}>Waiting for your partner to enter the same code…</Text>
              <Pressable onPress={cancelAndReset} style={styles.secondaryCta}>
                <Text style={styles.secondaryCtaText}>Cancel</Text>
              </Pressable>
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
            <Text style={styles.body}>Setting up your connection channel…</Text>
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
            <Pressable style={styles.cta} onPress={cancelAndReset} testID="pair.retry">
              <Text style={styles.ctaText}>Try again</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function ChooseMode(props: { onPickQr: () => void; onPickRelay: () => void }): JSX.Element {
  return (
    <>
      <Text style={styles.body}>
        Pick how you and your partner are pairing. Same-room scanning is fastest; the shared code
        works from anywhere.
      </Text>
      <Pressable
        accessibilityRole="button"
        style={styles.cta}
        onPress={props.onPickQr}
        testID="pair.mode.qr"
      >
        <Text style={styles.ctaText}>We're together — scan QR codes</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.ctaAlt}
        onPress={props.onPickRelay}
        testID="pair.mode.relay"
      >
        <Text style={styles.ctaText}>We're apart — use a shared code</Text>
      </Pressable>
    </>
  );
}

function QrPhase(props: {
  selfQr: string;
  onScanned: (text: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [showScanner, setShowScanner] = useState(false);

  if (!showScanner) {
    return (
      <>
        <Text style={styles.body}>
          Show this QR code to your partner. They'll scan it, then you'll scan theirs.
        </Text>
        <View style={styles.qrBox}>
          <QRCode value={props.selfQr} size={220} backgroundColor="#0a0a0a" color="#f5f5f5" />
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.cta}
          onPress={() => setShowScanner(true)}
          testID="pair.qr.scan"
        >
          <Text style={styles.ctaText}>Scan your partner's QR</Text>
        </Pressable>
        <Pressable onPress={props.onCancel} style={styles.secondaryCta}>
          <Text style={styles.secondaryCtaText}>Cancel</Text>
        </Pressable>
      </>
    );
  }

  if (!permission) {
    return <ActivityIndicator />;
  }
  if (!permission.granted) {
    return (
      <>
        <Text style={styles.body}>We need camera access to scan your partner's pairing QR.</Text>
        <Pressable style={styles.cta} onPress={() => void requestPermission()}>
          <Text style={styles.ctaText}>Allow camera</Text>
        </Pressable>
        <Pressable onPress={props.onCancel} style={styles.secondaryCta}>
          <Text style={styles.secondaryCtaText}>Cancel</Text>
        </Pressable>
      </>
    );
  }

  return (
    <>
      <Text style={styles.body}>Point your camera at your partner's QR code.</Text>
      <View style={styles.cameraBox}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => props.onScanned(data)}
        />
      </View>
      <Pressable onPress={() => setShowScanner(false)} style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaText}>Show my QR instead</Text>
      </Pressable>
    </>
  );
}

function RelayCodePhase(props: {
  value: string;
  onChange: (v: string) => void;
  onConnect: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <Text style={styles.body}>
        Agree on a short code with your partner (text it, say it out loud — anything). Both of you
        type the same code here and tap Connect. 6–16 letters, digits, or dashes.
      </Text>
      <TextInput
        style={styles.codeInput}
        value={props.value}
        onChangeText={props.onChange}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="e.g. bluefox42"
        placeholderTextColor="#5a5a5a"
        testID="pair.relay.code"
      />
      <Pressable
        accessibilityRole="button"
        style={styles.cta}
        onPress={props.onConnect}
        testID="pair.relay.connect"
      >
        <Text style={styles.ctaText}>Connect</Text>
      </Pressable>
      <Pressable onPress={props.onCancel} style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaText}>Back</Text>
      </Pressable>
    </>
  );
}

async function generateSelfKeys(): Promise<SelfKeys> {
  const identity = await generateX25519KeyPair();
  const ephemeral = await generateX25519KeyPair();
  return {
    identityPub: identity.publicKey,
    identityPriv: identity.privateKey,
    ephemeralPub: ephemeral.publicKey,
    ephemeralPriv: ephemeral.privateKey,
  };
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
  ctaAlt: {
    backgroundColor: '#2a2a2a',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  secondaryCta: { paddingVertical: 10, alignItems: 'center' },
  secondaryCtaText: { color: '#7a7a7a', fontSize: 13 },
  qrBox: {
    alignSelf: 'center',
    padding: 16,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
  },
  cameraBox: {
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  codeInput: {
    color: '#f5f5f5',
    fontSize: 18,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    letterSpacing: 1,
  },
  error: { color: '#ff6b6b', fontSize: 14 },
});
