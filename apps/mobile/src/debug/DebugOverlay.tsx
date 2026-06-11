import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DEBUG_OVERLAY_ENABLED } from './config';
import { useDebugLog, type DebugLine } from './log-store';

/**
 * Always-on debug overlay rendered above every other screen. Lets
 * testers see boot pipeline events + button presses + navigation
 * attempts without a USB cable + Xcode console. Tap the header to
 * collapse it to a thin handle so it doesn't block the UI underneath
 * while you read.
 *
 * Returns null when `EXPO_PUBLIC_DEBUG_OVERLAY` isn't `1`, so the
 * component file can be left imported in App.tsx with zero cost in
 * external-tester / production builds.
 */
export function DebugOverlay(): JSX.Element | null {
  const lines = useDebugLog((s) => s.lines);
  const clear = useDebugLog((s) => s.clear);
  const scrollRef = useRef<ScrollView | null>(null);
  const [open, setOpen] = useState(true);

  // Auto-scroll the log to the latest line. Without this the operator
  // would have to manually scroll every time a new event lands.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
  }, [lines, open]);

  if (!DEBUG_OVERLAY_ENABLED) return null;

  if (!open) {
    return (
      <Pressable style={styles.collapsedHandle} onPress={() => setOpen(true)} testID="debug.expand">
        <Text style={styles.handleText}>▲ debug ({lines.length})</Text>
      </Pressable>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.container} testID="debug.overlay">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={styles.headerHit}
          testID="debug.collapse"
        >
          <Text style={styles.headerText}>▼ debug ({lines.length})</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={clear}
          style={styles.clearHit}
          testID="debug.clear"
        >
          <Text style={styles.clearText}>clear</Text>
        </Pressable>
      </View>
      <ScrollView
        ref={(r) => {
          scrollRef.current = r;
        }}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {lines.map((l) => (
          <LineView key={l.id} line={l} />
        ))}
      </ScrollView>
    </View>
  );
}

function LineView({ line }: { line: DebugLine }): JSX.Element {
  const time = new Date(line.at).toISOString().slice(11, 23); // HH:MM:SS.mmm
  return (
    <Text
      style={[
        styles.line,
        line.level === 'error' && styles.error,
        line.level === 'warn' && styles.warn,
      ]}
    >
      <Text style={styles.time}>{time} </Text>
      <Text style={styles.tag}>{line.tag}</Text>
      <Text> {line.message}</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '40%',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderTopWidth: 1,
    borderTopColor: '#3a3a3a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1a1a1a',
  },
  headerHit: { paddingVertical: 4, paddingRight: 12 },
  headerText: { color: '#9ec5ff', fontSize: 12, fontWeight: '600' },
  clearHit: { paddingVertical: 4, paddingHorizontal: 8 },
  clearText: { color: '#a0a0a0', fontSize: 12 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 10, paddingVertical: 6, paddingBottom: 24 },
  line: { color: '#d0d0d0', fontSize: 11, lineHeight: 14, fontFamily: 'Menlo' },
  time: { color: '#5e5e5e' },
  tag: { color: '#9eff9e' },
  warn: { color: '#ffd47a' },
  error: { color: '#ff8a8a' },
  collapsedHandle: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
  },
  handleText: { color: '#9ec5ff', fontSize: 11 },
});
