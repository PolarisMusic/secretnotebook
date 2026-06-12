import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DEBUG_OVERLAY_ENABLED } from './config';
import { useDebugLog, type DebugLine } from './log-store';

/**
 * Always-on debug overlay.
 *
 * Previously rendered inside a transparent `<Modal>` so it'd paint above
 * react-native-screens' native UIViewControllers. That backfired hard:
 * on iOS, Modal allocates its own UIWindow that sits above the main
 * app's window. Even with `pointerEvents="box-none"`, the modal's
 * window swallowed every touch landing in its "transparent" areas,
 * because those touches got routed to the modal window's hit-testing
 * (which then said "no child wants this") rather than ever reaching
 * the main app window underneath. Result: ALL taps in the entire app
 * died — Pressable, TouchableOpacity, raw responder, RNGH RectButton,
 * native <Button>. Scroll gestures still worked because UIScrollView
 * installs its own UIPanGestureRecognizer that gets touches before
 * the responder chain.
 *
 * Render as a regular position-absolute View instead. If
 * react-native-screens paints over it, the overlay will disappear,
 * but at least taps in the rest of the app will work again. With
 * `enableScreens(false)` (set in App.tsx) screens are JS-only, so
 * the overlay should sit above everything via standard React Native
 * z-ordering.
 */
export function DebugOverlay(): JSX.Element | null {
  const lines = useDebugLog((s) => s.lines);
  const clear = useDebugLog((s) => s.clear);
  const scrollRef = useRef<ScrollView | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
  }, [lines, open]);

  if (!DEBUG_OVERLAY_ENABLED) return null;

  if (!open) {
    return (
      <View pointerEvents="box-none" style={styles.root}>
        <Pressable
          style={styles.collapsedHandle}
          onPress={() => setOpen(true)}
          testID="debug.expand"
        >
          <Text style={styles.handleText}>▼ debug ({lines.length})</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.root}>
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
  // Anchored to the top of the screen. `pointerEvents="box-none"` so
  // only the actual rendered panel/handle captures touches; the empty
  // bottom area is invisible to the responder system.
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // bottom omitted on purpose — root only covers the area its child
    // occupies, leaving the rest of the screen fully tappable.
  },
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
    paddingTop: 50, // clear the iOS notch / Dynamic Island
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
    paddingTop: 50,
    paddingBottom: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
  },
  handleText: { color: '#9ec5ff', fontSize: 11 },
});
