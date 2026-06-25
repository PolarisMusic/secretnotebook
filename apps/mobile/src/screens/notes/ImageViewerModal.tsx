import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface ImageViewerModalProps {
  /** URI of the decrypted image to show full-screen, or null when closed. */
  readonly uri: string | null;
  readonly onClose: () => void;
}

/**
 * Full-screen image viewer. Tap a photo in the note detail to open it here at
 * full size with pinch-to-zoom.
 *
 * Zoom is the ScrollView's native pinch (maximumZoomScale) rather than a
 * gesture-handler/reanimated based viewer — those libraries are deliberately
 * kept out of this app (they were tied to the earlier iOS dead-touch
 * regression; see components/AppMenu). Native ScrollView zoom is iOS-only;
 * on Android the image still opens full-screen, just without pinch. Closing is
 * the Done button or the hardware back button (onRequestClose).
 */
export function ImageViewerModal(props: ImageViewerModalProps): JSX.Element {
  const { width, height } = useWindowDimensions();
  const { uri } = props;
  const imageHeight = height - 96; // leave room for the top bar + insets
  return (
    <Modal
      visible={uri != null}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
      testID="image-viewer"
    >
      <SafeAreaView style={styles.backdrop} edges={['top', 'bottom']}>
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            hitSlop={12}
            onPress={props.onClose}
            style={styles.closeBtn}
            testID="image-viewer.close"
          >
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
        {uri != null ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.zoomContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            bouncesZoom
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              source={{ uri }}
              style={{ width, height: imageHeight }}
              resizeMode="contain"
              testID="image-viewer.image"
            />
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000' },
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  closeText: { color: '#f5f5f5', fontSize: 17, fontWeight: '600' },
  fill: { flex: 1 },
  zoomContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
});
