import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface ActionSheetAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly style?: 'default' | 'destructive';
  readonly disabled?: boolean;
  readonly testID?: string;
}

export interface ActionSheetProps {
  readonly visible: boolean;
  readonly title: string;
  readonly message?: string;
  readonly actions: ReadonlyArray<ActionSheetAction>;
  readonly onCancel: () => void;
  readonly cancelLabel?: string;
  readonly testID?: string;
}

/**
 * Bottom-anchored modal sheet for multi-action menus. Replaces the
 * `Alert.alert(title, msg, [...buttons])` pattern, which collapses past
 * three buttons on Android. Each action renders as a separate Pressable
 * row so any number of choices can show on both platforms.
 */
export function ActionSheet(props: ActionSheetProps): JSX.Element {
  const cancelLabel = props.cancelLabel ?? 'Cancel';
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <Pressable
        style={styles.backdrop}
        onPress={props.onCancel}
        testID={props.testID ? `${props.testID}.backdrop` : undefined}
      >
        <SafeAreaView style={styles.sheetWrap} edges={['bottom']} pointerEvents="box-none">
          <Pressable style={styles.sheet} onPress={() => undefined} testID={props.testID}>
            <Text style={styles.title}>{props.title}</Text>
            {props.message ? <Text style={styles.message}>{props.message}</Text> : null}
            <ScrollView bounces={false}>
              {props.actions.map((a, i) => (
                <Pressable
                  key={`${a.label}-${i}`}
                  accessibilityRole="button"
                  disabled={a.disabled}
                  onPress={a.onPress}
                  testID={a.testID}
                  style={({ pressed }) => [styles.row, pressed && !a.disabled && styles.rowPressed]}
                >
                  <Text
                    style={[
                      styles.rowText,
                      a.style === 'destructive' && styles.rowTextDestructive,
                      a.disabled && styles.rowTextDisabled,
                    ]}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.cancelWrap}>
              <Pressable
                accessibilityRole="button"
                onPress={props.onCancel}
                style={({ pressed }) => [styles.cancelRow, pressed && styles.rowPressed]}
                testID={props.testID ? `${props.testID}.cancel` : undefined}
              >
                <Text style={styles.cancelText}>{cancelLabel}</Text>
              </Pressable>
            </View>
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    maxHeight: '85%',
  },
  title: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  message: {
    color: '#a0a0a0',
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 4,
    marginTop: 6,
    marginBottom: 4,
  },
  row: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2a',
  },
  rowPressed: {
    backgroundColor: '#1c1c1c',
  },
  rowText: {
    color: '#9ec5ff',
    fontSize: 16,
    fontWeight: '600',
  },
  rowTextDestructive: {
    color: '#ff8a8a',
  },
  rowTextDisabled: {
    color: '#5a5a5a',
  },
  cancelWrap: {
    marginTop: 8,
  },
  cancelRow: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '600',
  },
});
