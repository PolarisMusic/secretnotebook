import { bytesToHex } from '@secretnotebook/crypto';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../db/store';
import { wipeAttachmentDirs } from '../features/attachments/native';
import { useSyncEngineStore } from '../features/connection-channel/store';
import { cancelSever, maybeFinalizeSever, scheduleSever } from '../features/connection/sever';
import { useConnectionStore } from '../state/connection';

function whenText(severAt: number): string {
  const secs = severAt - Math.floor(Date.now() / 1000);
  if (secs <= 0) return 'now';
  const days = Math.floor(secs / 86_400);
  if (days >= 1) return `in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(secs / 3_600);
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const mins = Math.max(1, Math.floor(secs / 60));
  return `in ${mins} minute${mins === 1 ? '' : 's'}`;
}

/**
 * App-wide grace-period banner for a pending connection sever (R8). Shows
 * a countdown to the wipe with: "Keep connection" (undo — initiator only)
 * and "End now" (either side; wipes immediately). Renders nothing when no
 * sever is pending. Mounted once above the navigator, like SafeWordAlert.
 */
export function SeverBanner(): JSX.Element | null {
  const insets = useSafeAreaInsets();
  const engine = useSyncEngineStore((s) => s.engine);
  const setEngine = useSyncEngineStore((s) => s.setEngine);
  const exec = useDatabaseStore((s) => s.exec);
  const severAt = useConnectionStore((s) => s.severAt);
  const severInitiatedByHex = useConnectionStore((s) => s.severInitiatedByHex);
  const setSever = useConnectionStore((s) => s.setSever);
  const resetToUnpaired = useConnectionStore((s) => s.resetToUnpaired);
  const [busy, setBusy] = useState(false);

  const isInitiator = engine != null && severInitiatedByHex === bytesToHex(engine.selfPub);

  const onUndo = useCallback(async () => {
    if (!exec || !engine || busy) return;
    setBusy(true);
    try {
      await cancelSever({ exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) });
      setSever(null, null);
    } catch {
      // Leave it pending if the undo couldn't be written; the banner stays.
    } finally {
      setBusy(false);
    }
  }, [exec, engine, busy, setSever]);

  const onEndNow = useCallback(async () => {
    if (!exec || !engine || busy) return;
    setBusy(true);
    try {
      await scheduleSever(
        { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
        { graceSeconds: 0 },
      );
      try {
        await engine.flush(); // best-effort: deliver the sever op before wiping
      } catch {
        // offline — partner learns on their own due-check / next pull
      }
      const wiped = await maybeFinalizeSever({ exec, deleteAttachmentFiles: wipeAttachmentDirs });
      if (wiped) {
        resetToUnpaired();
        setEngine(null);
      }
    } finally {
      setBusy(false);
    }
  }, [exec, engine, busy, resetToUnpaired, setEngine]);

  if (severAt == null || !engine) return null;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]} testID="sever.banner">
      <Text style={styles.text}>
        {isInitiator ? 'You’re ending this connection' : 'Your partner is ending this connection'} —
        all shared notes, secrets, and points will be wiped {whenText(severAt)}.
      </Text>
      <View style={styles.row}>
        {isInitiator && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            style={styles.keepBtn}
            hitSlop={6}
            onPress={() => void onUndo()}
            testID="sever.undo"
          >
            <Text style={styles.keepText}>Keep connection</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={styles.endBtn}
          hitSlop={6}
          onPress={() => void onEndNow()}
          testID="sever.endNow"
        >
          <Text style={styles.endText}>End now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#2a1414',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#5a2a2a',
  },
  text: { color: '#ffd0d0', fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  keepBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#2a2a3a',
  },
  keepText: { color: '#cdd6ff', fontSize: 14, fontWeight: '700' },
  endBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#5a2a2a',
  },
  endText: { color: '#ffb4b4', fontSize: 14, fontWeight: '700' },
});
