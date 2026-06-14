import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDatabaseStore } from '../db/store';
import { useSyncEngineStore } from '../features/connection-channel/store';
import {
  ackTrigger,
  getActiveTrigger,
  type ActiveTrigger,
  type TriggerStoreDeps,
} from '../features/safeword/trigger-store';

/**
 * App-wide alert for an inbound safe-word trigger. Mounted once at the
 * MainStack root so it covers every screen; the active signal lives in
 * SQLite, so it survives a restart and stays up until the user confirms
 * receipt (no backdrop dismiss — acknowledging is the only way out). Polls
 * so the partner's trigger op surfaces shortly after the sync ticker applies
 * it.
 */
export function SafeWordAlert(): JSX.Element | null {
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [active, setActive] = useState<ActiveTrigger | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setActive(null);
      return;
    }
    const a = await getActiveTrigger(exec, engine.selfPub);
    setActive(a && a.direction === 'inbound' ? a : null);
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(() => void refresh(), 5000);
    return () => clearInterval(handle);
  }, [refresh]);

  if (!active || !exec || !engine) return null;

  const onAck = (): void => {
    const deps: TriggerStoreDeps = {
      exec,
      selfPubkey: engine.selfPub,
      enqueue: (op) => engine.enqueue(op),
    };
    setBusy(true);
    void (async () => {
      try {
        await ackTrigger(deps, active.id);
        await refresh();
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Safe word</Text>
          <Text style={styles.body}>Your partner used the safe word.</Text>
          <Pressable
            accessibilityRole="button"
            style={[styles.cta, busy && styles.ctaDisabled]}
            disabled={busy}
            hitSlop={8}
            onPress={onAck}
            testID="safeword-alert.ack"
          >
            {busy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.ctaText}>Confirm received</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1c1010',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#7a2a2a',
    padding: 24,
    gap: 14,
  },
  title: {
    color: '#ff8a8a',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  body: { color: '#ffe0e0', fontSize: 20, fontWeight: '600', lineHeight: 26 },
  cta: {
    backgroundColor: '#e06a6a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
});
