import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '../../components/ScreenHeader';
import {
  recordSyncCycle,
  recordSyncError,
  useSyncDebugStore,
  type SyncDebugSnapshot,
} from '../../features/connection-channel/debug-store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { shareTextFile } from '../../features/notes/share-native';

/**
 * In-app Sync diagnostics. Surfaces the live transfer state so partner-note
 * delivery can be debugged on a TestFlight build with no Metro / Console.app.
 *
 * How to read it (run on BOTH phones, side by side):
 *   - `base` must match. `root`/`conn` must match (same pairing).
 *   - This phone's "Send inbox" must equal the OTHER phone's "Receive inbox".
 *     If they differ, the two devices derived different connection roots at
 *     pairing — re-pair fresh.
 *   - Write a note, hit "Sync now" on the sender: outbox should go 1 → 0 and
 *     "Last flush" should read delivered=1. If it stays failed=1, read
 *     "Last error" (the relay POST is being rejected).
 *   - On the receiver, "Last pull" fetched should rise then applied should
 *     match it. fetched>0 but applied=0 ⇒ decrypt/apply failure.
 */
export function SyncDebugRoute(): JSX.Element {
  const engine = useSyncEngineStore((s) => s.engine);
  const snapshot = useSyncDebugStore((s) => s.snapshot);
  const [busy, setBusy] = useState(false);

  const onSyncNow = useCallback(async () => {
    if (!engine || busy) return;
    setBusy(true);
    try {
      const flushed = await engine.flush();
      const pulled = await engine.pull();
      await recordSyncCycle(engine, flushed, pulled);
    } catch (e) {
      recordSyncError('manual', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [engine, busy]);

  const onShare = useCallback(async () => {
    await shareTextFile(
      'sync-diagnostics.txt',
      snapshotToText(snapshot, engine != null),
      'text/plain',
    );
  }, [snapshot, engine]);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.sync-debug">
      <ScreenHeader title="Sync diagnostics" />
      <ScrollView contentContainerStyle={styles.content}>
        {engine == null ? (
          <View style={styles.tile}>
            <Text style={styles.tileText}>Not paired</Text>
            <Text style={styles.hint}>
              No sync engine yet. Pair with a partner, then come back here.
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>SERVER</Text>
        <Row label="API base" value={snapshot?.baseUrl ?? '—'} mono />
        <Text style={styles.hint}>Must be identical on both phones.</Text>

        <Text style={styles.sectionLabel}>CONNECTION</Text>
        <Row label="conn" value={snapshot?.conn ?? '—'} mono />
        <Row label="root" value={snapshot?.rootHex ?? '—'} mono />
        <Row label="self" value={snapshot?.selfHex ?? '—'} mono />
        <Row label="peer" value={snapshot?.peerHex ?? '—'} mono />
        <Text style={styles.hint}>
          conn + root must match the partner&apos;s. They differ ⇒ you paired under different
          builds; re-pair fresh.
        </Text>

        <Text style={styles.sectionLabel}>ROUTING</Text>
        <Row label="Send inbox" value={snapshot?.sendInbox ?? '—'} mono />
        <Row label="Receive inbox" value={snapshot?.pollInbox ?? '—'} mono />
        <Text style={styles.hint}>
          Your “Send inbox” must equal the partner&apos;s “Receive inbox”. Mismatch ⇒ root mismatch.
        </Text>

        <Text style={styles.sectionLabel}>TRANSFER</Text>
        <Row label="Outbox depth" value={String(snapshot?.outboxDepth ?? 0)} />
        <Row label="Last flush" value={flushText(snapshot)} />
        <Row label="Last pull" value={pullText(snapshot)} />
        <Row
          label="Last error"
          value={snapshot?.lastError ?? 'none'}
          danger={!!snapshot?.lastError}
        />
        <Row label="Updated" value={agoText(snapshot?.updatedAt)} />

        <Pressable
          accessibilityRole="button"
          style={[styles.cta, busy && styles.ctaDisabled]}
          hitSlop={8}
          disabled={busy || engine == null}
          onPress={() => void onSyncNow()}
          testID="sync-debug.sync-now"
        >
          <Text style={styles.ctaText}>{busy ? 'Syncing…' : 'Sync now'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondary}
          hitSlop={8}
          onPress={() => void onShare()}
          testID="sync-debug.share"
        >
          <Text style={styles.secondaryText}>Share diagnostics</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row(props: {
  label: string;
  value: string;
  mono?: boolean;
  danger?: boolean;
}): JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{props.label}</Text>
      <Text
        style={[styles.rowValue, props.mono && styles.mono, props.danger && styles.dangerValue]}
        numberOfLines={2}
      >
        {props.value}
      </Text>
    </View>
  );
}

function flushText(s: SyncDebugSnapshot | null): string {
  const f = s?.lastFlush;
  if (!f) return '—';
  return `attempted=${f.attempted} delivered=${f.delivered} failed=${f.failed}`;
}

function pullText(s: SyncDebugSnapshot | null): string {
  const p = s?.lastPull;
  if (!p) return '—';
  const failed = p.fetched - p.applied - p.duplicates;
  const tail = failed > 0 ? ` apply-failed=${failed}` : '';
  return `fetched=${p.fetched} applied=${p.applied} dup=${p.duplicates}${tail}`;
}

function agoText(updatedAt: number | undefined): string {
  if (!updatedAt) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  return `${secs}s ago`;
}

function snapshotToText(s: SyncDebugSnapshot | null, paired: boolean): string {
  if (!s) return `paired=${paired}\n(no sync cycle yet)`;
  return [
    `paired=${paired}`,
    `base=${s.baseUrl}`,
    `conn=${s.conn} root=${s.rootHex} self=${s.selfHex} peer=${s.peerHex}`,
    `sendInbox=${s.sendInbox} pollInbox=${s.pollInbox}`,
    `outboxDepth=${s.outboxDepth}`,
    `flush=${flushText(s)}`,
    `pull=${pullText(s)}`,
    `lastError=${s.lastError ?? 'none'}`,
    `updated=${agoText(s.updatedAt)}`,
  ].join('\n');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 8 },
  sectionLabel: {
    color: '#7a7a7a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 16,
  },
  tile: { backgroundColor: '#141414', borderRadius: 10, padding: 16, gap: 6 },
  tileText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  rowLabel: { color: '#9e9e9e', fontSize: 14, flexShrink: 0 },
  rowValue: { color: '#f5f5f5', fontSize: 14, flexShrink: 1, textAlign: 'right' },
  mono: { fontFamily: 'Courier', letterSpacing: 0.5 },
  dangerValue: { color: '#ffb4b4' },
  hint: { color: '#7a7a7a', fontSize: 13, lineHeight: 18, marginTop: 2 },
  cta: {
    backgroundColor: '#9ec5ff',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
  secondary: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryText: { color: '#cfcfcf', fontSize: 15, fontWeight: '600' },
});
