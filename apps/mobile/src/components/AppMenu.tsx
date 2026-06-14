import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  { key: 'saved', label: 'Saved', target: 'SavedByYou' },
  { key: 'feed', label: 'Feed', target: 'GlobalFeed' },
  { key: 'settings', label: 'Settings', target: 'Settings' },
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
          <SafeAreaView edges={['top', 'left']}>
            <View style={styles.panel}>
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
          </SafeAreaView>
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
    paddingHorizontal: 20,
    paddingTop: 16,
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
