import { useRef } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface ImageViewerModalProps {
  /** All image URIs available for navigation; or a single-element array. */
  readonly uris: readonly string[];
  /** Index into `uris` that is currently open; null means the viewer is closed. */
  readonly index: number | null;
  readonly onClose: () => void;
  /** Called when the user swipes to a different photo. */
  readonly onChangeIndex?: (next: number) => void;
}

const SWIPE_THRESHOLD = 60;

/**
 * Full-screen image viewer with swipe navigation. Swipe left/right to move
 * between photos; swipe down (or tap Done) to dismiss. Pinch-to-zoom via
 * ScrollView's native maximumZoomScale (iOS only; Android shows full-screen
 * without pinch).
 *
 * SafeAreaView inside a Modal misreports insets on iOS (it runs in a separate
 * native window the provider can't measure). We read insets from the hook
 * (which crosses the Modal boundary via context) and apply them as plain
 * padding instead.
 *
 * Gesture detection uses PanResponder — no react-native-gesture-handler
 * dependency required.
 */
export function ImageViewerModal(props: ImageViewerModalProps): JSX.Element {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { uris, index, onClose, onChangeIndex } = props;
  const visible = index != null;
  const currentUri = index != null ? uris[index] : null;
  const canPrev = index != null && index > 0;
  const canNext = index != null && index < uris.length - 1;

  const panStart = useRef<{ x: number; y: number } | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
      onPanResponderGrant: (_, gs) => {
        panStart.current = { x: gs.x0, y: gs.y0 };
      },
      onPanResponderRelease: (_, gs) => {
        if (!panStart.current) return;
        const dx = gs.dx;
        const dy = gs.dy;
        if (Math.abs(dy) > Math.abs(dx) && dy > SWIPE_THRESHOLD) {
          // Swipe down → close
          onClose();
        } else if (dx < -SWIPE_THRESHOLD && canNext && onChangeIndex && index != null) {
          onChangeIndex(index + 1);
        } else if (dx > SWIPE_THRESHOLD && canPrev && onChangeIndex && index != null) {
          onChangeIndex(index - 1);
        }
        panStart.current = null;
      },
    }),
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="image-viewer"
    >
      <View style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Top bar */}
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            hitSlop={12}
            onPress={onClose}
            style={styles.closeBtn}
            testID="image-viewer.close"
          >
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
          {uris.length > 1 && index != null && (
            <Text style={styles.counter}>
              {index + 1} / {uris.length}
            </Text>
          )}
        </View>

        {/* Image */}
        <View style={styles.imageWrap} {...panResponder.panHandlers} testID="image-viewer.gesture">
          {currentUri != null && (
            <Image
              source={{ uri: currentUri }}
              style={{ width, flex: 1 }}
              resizeMode="contain"
              testID="image-viewer.image"
            />
          )}
        </View>

        {/* Swipe nav arrows (visible hint) */}
        {uris.length > 1 && (
          <View style={styles.navRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous photo"
              disabled={!canPrev}
              hitSlop={16}
              onPress={() => canPrev && onChangeIndex && index != null && onChangeIndex(index - 1)}
              testID="image-viewer.prev"
            >
              <Text style={[styles.navArrow, !canPrev && styles.navArrowDisabled]}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next photo"
              disabled={!canNext}
              hitSlop={16}
              onPress={() => canNext && onChangeIndex && index != null && onChangeIndex(index + 1)}
              testID="image-viewer.next"
            >
              <Text style={[styles.navArrow, !canNext && styles.navArrowDisabled]}>›</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000' },
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  closeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  closeText: { color: '#f5f5f5', fontSize: 17, fontWeight: '600' },
  counter: { color: '#a0a0a0', fontSize: 14 },
  imageWrap: { flex: 1 },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  navArrow: { color: '#f5f5f5', fontSize: 40, fontWeight: '300' },
  navArrowDisabled: { color: '#3a3a3a' },
});
