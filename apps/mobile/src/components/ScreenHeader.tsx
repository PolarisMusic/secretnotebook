import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMenuStore } from '../state/menu';
import { AppMenu } from './AppMenu';

export interface ScreenHeaderProps {
  readonly title: string;
  /** Optional right-aligned action (e.g. a Post button). */
  readonly right?: ReactNode;
}

/**
 * Standard top bar for the main screens: a comfortably-tappable hamburger
 * (opens the overlay menu), the screen title, and an optional right action.
 * Also mounts <AppMenu/> so every screen that uses the header has the menu
 * available. Buttons use generous hit areas to fix the prior tiny-pill
 * touch-target problem.
 */
export function ScreenHeader(props: ScreenHeaderProps): JSX.Element {
  const open = useMenuStore((s) => s.open);
  return (
    <>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          style={styles.hamburger}
          hitSlop={12}
          onPress={open}
          testID="header.menu"
        >
          <Text style={styles.hamburgerGlyph}>☰</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {props.title}
        </Text>
        <View style={styles.right}>{props.right ?? null}</View>
      </View>
      <AppMenu />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  hamburger: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamburgerGlyph: { color: '#f5f5f5', fontSize: 22, lineHeight: 26 },
  title: { color: '#f5f5f5', fontSize: 20, fontWeight: '700', flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
