import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DEBUG_OVERLAY_ENABLED } from './config';
import { useDebugLog, type DebugLine } from './log-store';

/**
 * Always-on debug overlay. Rendered inside a transparent `Modal` so it
 * paints above react-native-screens' native UIViewControllers — the
 * previous absolute-positioned sibling approach got hidden underneath
 * the native stack on iOS. Modal windows sit on a separate iOS layer
 * that the native screens can't cover.
 *
 * `pointerEvents="box-none"` on the modal's root + on the spacer fill
 * lets touches through to the app underneath; only the overlay panel
 * itself captures input. Without this the modal would intercept every
 * tap and make the rest of the app unusable.
 *
 * Returns null when `DEBUG_OVERLAY_ENABLED` is false — short-circuit at
 * the top so production builds bear no UI cost.
 */
export function DebugOverlay(): JSX.Element | null {
  const lines = useDebugLog((s) => s.lines);
  const clear = useDebugLog((s) => s.clear);
  const scrollRef = useRef<ScrollView | null>(null);
  const [open, setOpen] = useState(true);

  // Auto-scroll the log to the latest line.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
  }, [lines, open]);

  if (!DEBUG_OVERLAY_ENABLED) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      // statusBarTranslucent only matters on Android; harmless on iOS.
      statusBarTranslucent
      // No close action — overlay is always present; collapsing is a
      // JS-side state change that doesn't dismiss the modal.
      onRequestClose={() => undefined}
    >
      <View pointerEvents="box-none" style={styles.modalRoot}>
        {/* Spacer fills the lower area but doesn't capture touches —
            the overlay now sits at the top, so the spacer goes
            BELOW. Order matters because column flex puts top child
            first. */}
        {open ? (
          <View style={styles.container} testID="debug.overlay">
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
              {lines.length === 0 ? (
                <Text style={styles.line}>
                  <Text style={styles.tag}>debug</Text>
                  <Text> overlay mounted — waiting for events</Text>
                </Text>
              ) : (
                lines.map((l) => <LineView key={l.id} line={l} />)
              )}
            </ScrollView>
          </View>
        ) : (
          <Pressable
            style={styles.collapsedHandle}
            onPress={() => setOpen(true)}
            testID="debug.expand"
          >
            <Text style={styles.handleText}>▼ debug ({lines.length})</Text>
          </Pressable>
        )}
        {/* Spacer goes AFTER the panel so column flex pins the panel
            to the top of the screen. */}
        <View pointerEvents="none" style={styles.spacer} />
      </View>
    </Modal>
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
  // Moved overlay to the TOP so it doesn't cover bottom-of-screen
  // buttons during the touch-diagnostic flow. Reduced maxHeight to
  // 25% so most of the screen is visible for tapping.
  modalRoot: { flex: 1, justifyContent: 'flex-start' },
  spacer: { flex: 1 },
  container: {
    maxHeight: '25%',
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    borderBottomWidth: 1,
    borderBottomColor: '#3a3a3a',
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
    paddingVertical: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
  },
  handleText: { color: '#9ec5ff', fontSize: 11 },
});
