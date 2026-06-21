import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  formatRendezvousCode,
  generateRendezvousCode,
  generateX25519KeyPair,
  isValidRendezvousCode,
  normalizeRendezvousCode,
} from '@secretnotebook/crypto';

import type { BiometricPrompt } from '../../features/pairing/biometric';
import { friendlyPairingError } from '../../features/pairing/errors';
import {
  runPairing,
  type PairingHooks,
  type PairingRun,
} from '../../features/pairing/orchestrator';
import { encodePairingQr, parsePairingQr } from '../../features/pairing/qr-code';
import { RelayTransport } from '../../features/pairing/relay-transport';
import type { PairingState, SelfKeys } from '../../features/pairing/state-machine';

type Mode = 'choose' | 'qr' | 'relay';

/**
 * QR sub-flow role. The QR carries a relay rendezvous code, so pairing is
 * symmetric: one device shows its QR, the other scans it, and both join the
 * same code over RelayTransport (the broken hello-over-QR dance is retired).
 */
type QrRole = 'pick' | 'show' | 'scan';

/**
 * Relay sub-flow role. To stop unrelated couples colliding on a guessable
 * shared phrase ("iloveyou"), users no longer invent the code: one device
 * `create`s a high-entropy code and the other `join`s by entering it.
 */
type RelayRole = 'pick' | 'create' | 'join';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

  // QR-mode state. The QR encodes a relay rendezvous code; pairing then runs
  // over the symmetric RelayTransport (startRelay), same as the typed-code
  // path — one device shows, the other scans, and both converge.
  const [qrRole, setQrRole] = useState<QrRole>('pick');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrScanError, setQrScanError] = useState<string | null>(null);
  const scanLockRef = useRef(false);

  // Relay-mode state.
  const [relayRole, setRelayRole] = useState<RelayRole>('pick');
  const [relayInput, setRelayInput] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [relayConnecting, setRelayConnecting] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

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

  function pickQrMode(): void {
    setMode('qr');
    setQrRole('pick');
    setQrCode(null);
    setQrScanError(null);
    scanLockRef.current = false;
    setState({ name: 'idle' });
  }

  /** "Show" side: mint a rendezvous code, render it as a QR, and start
   *  listening on the relay so we pair the moment the partner scans + joins. */
  async function startQrShow(): Promise<void> {
    setQrRole('show');
    setQrCode(null);
    setState({ name: 'idle' });
    try {
      const code = await generateRendezvousCode();
      setQrCode(code);
      await startRelay(code);
    } catch (err) {
      setState({ name: 'error', reason: errorMessage(err) });
    }
  }

  /** "Scan" side: open the camera. */
  function startQrScan(): void {
    setQrRole('scan');
    setQrScanError(null);
    scanLockRef.current = false;
    setState({ name: 'idle' });
  }

  /** Camera read: pull the relay code out of the QR and join that rendezvous.
   *  Non-pairing QRs parse to null, so we surface a hint and keep scanning. */
  function onQrScanned(text: string): void {
    if (scanLockRef.current) return;
    const code = parsePairingQr(text);
    if (code === null) {
      setQrScanError("That doesn't look like a UsNotes pairing QR.");
      return;
    }
    scanLockRef.current = true;
    setQrScanError(null);
    void startRelay(code);
  }

  function pickRelayMode(): void {
    setMode('relay');
    setRelayRole('pick');
    setRelayInput('');
    setCreatedCode(null);
    setRelayConnecting(false);
    setJoinError(null);
    setState({ name: 'idle' });
  }

  async function startRelayCreate(): Promise<void> {
    setRelayRole('create');
    setCreatedCode(null);
    setJoinError(null);
    setState({ name: 'idle' });
    try {
      // We mint the code so two couples can't both pick "iloveyou" and
      // cross-pair through the relay. 8 chars from a 31-symbol alphabet.
      const code = await generateRendezvousCode();
      setCreatedCode(code);
      await startRelay(code);
    } catch (err) {
      setState({ name: 'error', reason: errorMessage(err) });
    }
  }

  function startRelayJoin(): void {
    setRelayRole('join');
    setRelayInput('');
    setJoinError(null);
    setState({ name: 'idle' });
  }

  async function connectRelayJoin(): Promise<void> {
    const code = normalizeRendezvousCode(relayInput);
    if (!isValidRendezvousCode(code)) {
      setJoinError("That code doesn't look right — ask your partner to read it out again.");
      return;
    }
    setJoinError(null);
    await startRelay(code);
  }

  /** Shared relay entry point: POST our hello under `code` and poll for the
   *  peer. `code` is already in canonical wire form (lowercase, no dashes). */
  async function startRelay(code: string): Promise<void> {
    setRelayConnecting(true);
    setState({ name: 'idle' });
    try {
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
      await maybeFinishPairing(final, selfKeys);
    } catch (err) {
      setState({ name: 'error', reason: errorMessage(err) });
    } finally {
      setRelayConnecting(false);
    }
  }

  async function shareCreatedCode(): Promise<void> {
    if (createdCode === null) return;
    try {
      await Share.share({ message: `Our pairing code: ${formatRendezvousCode(createdCode)}` });
    } catch {
      // User dismissed the share sheet, or it's unavailable — non-fatal.
    }
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
    scanLockRef.current = false;
    setQrRole('pick');
    setQrCode(null);
    setQrScanError(null);
    setRelayRole('pick');
    setRelayInput('');
    setCreatedCode(null);
    setRelayConnecting(false);
    setJoinError(null);
    setState({ name: 'idle' });
    setMode('choose');
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.pair">
      <View style={styles.content}>
        <Text style={styles.title}>Pair with your partner</Text>

        {mode === 'choose' && state.name === 'idle' && (
          <ChooseMode onPickQr={pickQrMode} onPickRelay={pickRelayMode} />
        )}

        {mode === 'qr' && qrRole === 'pick' && state.name === 'idle' && (
          <QrRolePicker onShow={startQrShow} onScan={startQrScan} onCancel={cancelAndReset} />
        )}

        {mode === 'qr' &&
          qrRole === 'show' &&
          (state.name === 'idle' || state.name === 'scanning') &&
          (qrCode === null ? (
            <>
              <ActivityIndicator />
              <Text style={styles.body}>Preparing your QR…</Text>
            </>
          ) : (
            <QrShowPhase code={qrCode} onCancel={cancelAndReset} />
          ))}

        {mode === 'qr' &&
          qrRole === 'scan' &&
          (state.name === 'idle' || state.name === 'scanning') && (
            <QrScanPhase
              onScanned={onQrScanned}
              error={qrScanError}
              connecting={relayConnecting}
              onCancel={cancelAndReset}
            />
          )}

        {mode === 'relay' && relayRole === 'pick' && state.name === 'idle' && (
          <RelayRolePicker
            onCreate={startRelayCreate}
            onJoin={startRelayJoin}
            onCancel={cancelAndReset}
          />
        )}

        {mode === 'relay' &&
          relayRole === 'create' &&
          (state.name === 'idle' || state.name === 'scanning') &&
          (createdCode === null ? (
            <>
              <ActivityIndicator />
              <Text style={styles.body}>Preparing your code…</Text>
            </>
          ) : (
            <RelayCreatePhase
              code={createdCode}
              onShare={shareCreatedCode}
              onCancel={cancelAndReset}
            />
          ))}

        {mode === 'relay' && relayRole === 'join' && !relayConnecting && state.name === 'idle' && (
          <RelayJoinPhase
            value={relayInput}
            error={joinError}
            onChange={(v) => {
              setRelayInput(v);
              if (joinError !== null) setJoinError(null);
            }}
            onConnect={connectRelayJoin}
            onCancel={cancelAndReset}
          />
        )}

        {mode === 'relay' &&
          relayRole === 'join' &&
          relayConnecting &&
          (state.name === 'idle' || state.name === 'scanning') && (
            <>
              <ActivityIndicator />
              <Text style={styles.body}>Waiting for your partner…</Text>
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
            Paired! Taking you back to your notes…
          </Text>
        )}
        {state.name === 'error' && (
          <>
            <Text style={styles.error}>{friendlyPairingError(state.reason)}</Text>
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

function QrRolePicker(props: {
  onShow: () => void;
  onScan: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <Text style={styles.body}>
        One of you shows a QR code; the other scans it. Decide who does which — you only need to
        scan on one phone.
      </Text>
      <Pressable
        accessibilityRole="button"
        style={styles.cta}
        onPress={props.onShow}
        testID="pair.qr.show"
      >
        <Text style={styles.ctaText}>Show my QR code</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.ctaAlt}
        onPress={props.onScan}
        testID="pair.qr.scan"
      >
        <Text style={styles.ctaText}>Scan partner's QR</Text>
      </Pressable>
      <Pressable onPress={props.onCancel} style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaText}>Back</Text>
      </Pressable>
    </>
  );
}

function QrShowPhase(props: { code: string; onCancel: () => void }): JSX.Element {
  return (
    <>
      <Text style={styles.body}>
        Have your partner scan this with their UsNotes app. Keep this screen open — it pairs
        automatically once they scan.
      </Text>
      <View style={styles.qrBox}>
        <QRCode
          value={encodePairingQr(props.code)}
          size={220}
          backgroundColor="#0a0a0a"
          color="#f5f5f5"
        />
      </View>
      <Text style={styles.body}>
        Can't scan? Read them this code: {formatRendezvousCode(props.code)}
      </Text>
      <View style={styles.waitingRow}>
        <ActivityIndicator />
        <Text style={styles.body}>Waiting for your partner…</Text>
      </View>
      <Pressable onPress={props.onCancel} style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaText}>Cancel</Text>
      </Pressable>
    </>
  );
}

function QrScanPhase(props: {
  onScanned: (text: string) => void;
  error: string | null;
  connecting: boolean;
  onCancel: () => void;
}): JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();

  if (props.connecting) {
    return (
      <>
        <ActivityIndicator />
        <Text style={styles.body}>Code scanned — connecting to your partner…</Text>
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
      <Text style={styles.body}>Point your camera at your partner's pairing QR.</Text>
      <View style={styles.cameraBox}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => props.onScanned(data)}
        />
      </View>
      {props.error !== null && <Text style={styles.error}>{props.error}</Text>}
      <Pressable onPress={props.onCancel} style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaText}>Cancel</Text>
      </Pressable>
    </>
  );
}

function RelayRolePicker(props: {
  onCreate: () => void;
  onJoin: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <Text style={styles.body}>
        One of you creates a code and shares it; the other types it in. Decide who does which — you
        only need one code between you.
      </Text>
      <Pressable
        accessibilityRole="button"
        style={styles.cta}
        onPress={props.onCreate}
        testID="pair.relay.create"
      >
        <Text style={styles.ctaText}>Create a code</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.ctaAlt}
        onPress={props.onJoin}
        testID="pair.relay.join"
      >
        <Text style={styles.ctaText}>Enter partner's code</Text>
      </Pressable>
      <Pressable onPress={props.onCancel} style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaText}>Back</Text>
      </Pressable>
    </>
  );
}

function RelayCreatePhase(props: {
  code: string;
  onShare: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <Text style={styles.body}>
        Send this code to your partner — text it, Signal it, or read it out. They'll enter it on
        their phone. Keep this screen open; it pairs automatically once they do.
      </Text>
      <Text style={styles.relayCode} selectable testID="pair.relay.created">
        {formatRendezvousCode(props.code)}
      </Text>
      <View style={styles.waitingRow}>
        <ActivityIndicator />
        <Text style={styles.body}>Waiting for your partner…</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        style={styles.cta}
        onPress={props.onShare}
        testID="pair.relay.share"
      >
        <Text style={styles.ctaText}>Share code</Text>
      </Pressable>
      <Pressable onPress={props.onCancel} style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaText}>Cancel</Text>
      </Pressable>
    </>
  );
}

function RelayJoinPhase(props: {
  value: string;
  error: string | null;
  onChange: (v: string) => void;
  onConnect: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <Text style={styles.body}>
        Type the code your partner created and read to you, then tap Connect.
      </Text>
      <TextInput
        style={styles.codeInput}
        value={props.value}
        onChangeText={props.onChange}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        placeholder="e.g. K7QH-92RT"
        placeholderTextColor="#5a5a5a"
        testID="pair.relay.code"
      />
      {props.error !== null && <Text style={styles.error}>{props.error}</Text>}
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
  relayCode: {
    color: '#f5f5f5',
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    marginVertical: 12,
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
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
