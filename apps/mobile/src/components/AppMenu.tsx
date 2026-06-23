import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MainStackParamList } from '../navigation/MainStack';
import { useMenuStore } from '../state/menu';

type Nav = NativeStackNavigationProp<MainStackParamList>;

interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly target: keyof MainStackParamList;
}

const ITEMS: readonly MenuItem[] = [
  { key: 'notes', label: 'Notes', target: 'NotesList' },
  { key: 'unlock', label: 'Unlock', target: 'SecretUnlockList' },
  { key: 'saved', label: 'Saved', target: 'SavedByYou' },
  { key: 'feed', label: 'Feed', target: 'GlobalFeed' },
  { key: 'settings', label: 'Settings', target: 'Settings' },
  { key: 'diagnostics', label: 'Sync diagnostics', target: 'SyncDebug' },
];

/**
 * Lightweight hamburger menu. A plain Modal + absolute panel built from RN
 * primitives — deliberately NOT @react-navigation/drawer, which would pull
 * react-native-gesture-handler + reanimated back in (the libraries tied to
 * the earlier dead-touch regression on iOS 26.5). The backdrop Pressable
 * closes the menu; nothing is mounted when closed, so it can't trap touches.
 */
export function AppMenu(): JSX.Element | null {
  const isOpen = useMenuStore((s) => s.isOpen);
  const close = useMenuStore((s) => s.close);
  const navigation = useNavigation<Nav>();
  // Read the inset here, in the normal React tree under the root
  // SafeAreaProvider. A <Modal> presents in a separate native window the
  // provider can't measure, so a SafeAreaView *inside* the Modal reports a
  // zero top inset (the panel would collide with the status bar). The hook
  // value crosses the Modal boundary via context, so we apply it as plain
  // padding on the panel instead.
  const insets = useSafeAreaInsets();

  if (!isOpen) return null;

  function go(target: keyof MainStackParamList): void {
    close();
    navigation.navigate(target as never);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} testID="menu.backdrop">
        {/* Stop propagation: taps on the panel itself shouldn't close it. */}
        <Pressable style={styles.panelWrap} onPress={() => undefined}>
          <View
            style={[styles.panel, { paddingTop: insets.top + 16, paddingLeft: insets.left + 20 }]}
          >
            <Text style={styles.heading}>Menu</Text>
            {ITEMS.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                style={styles.item}
                hitSlop={6}
                onPress={() => go(item.target)}
                testID={`menu.${item.key}`}
              >
                <Text style={styles.itemText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', flexDirection: 'row' },
  panelWrap: { width: '74%', maxWidth: 320, height: '100%' },
  panel: {
    backgroundColor: '#141414',
    // paddingTop / paddingLeft are applied inline from safe-area insets.
    paddingRight: 20,
    gap: 4,
    height: '100%',
  },
  heading: {
    color: '#7a7a7a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  item: { paddingVertical: 16 },
  itemText: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
});
