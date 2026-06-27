import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FLAG_DETAIL_MAX, type PostFlagCategory } from '@secretnotebook/shared-types';

type Step = 'category' | 'detail-other' | 'confirm-reveal' | 'submitting';

interface Choice {
  readonly label: string;
  readonly category: PostFlagCategory;
}

const CHOICES: ReadonlyArray<Choice> = [
  { label: 'Sexual content', category: 'sexual' },
  { label: 'Violence', category: 'violent' },
  { label: 'Spam', category: 'spam' },
  { label: 'Reveals personal details', category: 'reveals_personal_details' },
  { label: 'Other (specify)…', category: 'other' },
];

const REVEAL_PERSONAL_WARNING =
  "This will hide the post permanently for everyone and log the original poster's identity to moderators. Use only when the post genuinely discloses someone's personal details.";

export interface FlagSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (category: PostFlagCategory, detail: string | undefined) => Promise<unknown>;
}

/**
 * Cross-platform flag picker. Replaces the older `promptForFlag` Alert
 * chain, which lost reasons past 3 buttons on Android and depended on
 * iOS-only Alert.prompt for the "Other" detail. Now a single Modal that
 * walks the viewer through pick-category → optional detail / confirmation
 * → submit, with native TextInput for the detail step.
 */
export function FlagSheet(props: FlagSheetProps): JSX.Element {
  const [step, setStep] = useState<Step>('category');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.visible) {
      setStep('category');
      setDetail('');
      setError(null);
    }
  }, [props.visible]);

  const submit = async (category: PostFlagCategory, d: string | undefined): Promise<void> => {
    setStep('submitting');
    setError(null);
    try {
      await props.onSubmit(category, d);
      props.onClose();
    } catch (e) {
      setError((e as Error).message ?? 'Could not submit');
      setStep(category === 'other' ? 'detail-other' : 'category');
    }
  };

  const onPickCategory = (category: PostFlagCategory): void => {
    if (category === 'other') {
      setStep('detail-other');
      return;
    }
    if (category === 'reveals_personal_details') {
      setStep('confirm-reveal');
      return;
    }
    void submit(category, undefined);
  };

  const onSubmitDetail = (): void => {
    const trimmed = detail.trim();
    if (trimmed.length === 0) {
      setError('Please briefly explain the reason.');
      return;
    }
    void submit('other', trimmed);
  };

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} onPress={props.onClose}>
        <SafeAreaView style={styles.sheetWrap} edges={['bottom']} pointerEvents="box-none">
          <Pressable style={styles.sheet} onPress={() => undefined} testID="flag-sheet">
            {step === 'category' && (
              <>
                <Text style={styles.title}>Flag this post</Text>
                <Text style={styles.message}>
                  Why are you reporting it? This obscures the post for everyone.
                </Text>
                {CHOICES.map((c) => (
                  <Pressable
                    key={c.category}
                    accessibilityRole="button"
                    onPress={() => onPickCategory(c.category)}
                    testID={`flag-sheet.choice.${c.category}`}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <Text style={styles.rowText}>{c.label}</Text>
                  </Pressable>
                ))}
                {error != null && <Text style={styles.error}>{error}</Text>}
                <View style={styles.cancelWrap}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={props.onClose}
                    style={({ pressed }) => [styles.cancelRow, pressed && styles.rowPressed]}
                    testID="flag-sheet.cancel"
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                </View>
              </>
            )}

            {step === 'detail-other' && (
              <>
                <Text style={styles.title}>Other reason</Text>
                <Text style={styles.message}>Briefly explain why this post should be removed.</Text>
                <TextInput
                  value={detail}
                  onChangeText={setDetail}
                  placeholder="What's wrong with this post?"
                  placeholderTextColor="#666"
                  multiline
                  maxLength={FLAG_DETAIL_MAX}
                  style={styles.input}
                  autoFocus
                  testID="flag-sheet.detail-input"
                />
                <Text style={styles.counter}>
                  {detail.length}/{FLAG_DETAIL_MAX}
                </Text>
                {error != null && <Text style={styles.error}>{error}</Text>}
                <View style={styles.row2}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setStep('category')}
                    style={({ pressed }) => [styles.secondary, pressed && styles.rowPressed]}
                    testID="flag-sheet.detail-back"
                  >
                    <Text style={styles.secondaryText}>Back</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={onSubmitDetail}
                    style={({ pressed }) => [styles.primary, pressed && styles.rowPressed]}
                    testID="flag-sheet.detail-submit"
                  >
                    <Text style={styles.primaryText}>Submit</Text>
                  </Pressable>
                </View>
              </>
            )}

            {step === 'confirm-reveal' && (
              <>
                <Text style={styles.title}>Are you sure?</Text>
                <Text style={styles.message}>{REVEAL_PERSONAL_WARNING}</Text>
                {error != null && <Text style={styles.error}>{error}</Text>}
                <View style={styles.row2}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setStep('category')}
                    style={({ pressed }) => [styles.secondary, pressed && styles.rowPressed]}
                    testID="flag-sheet.reveal-back"
                  >
                    <Text style={styles.secondaryText}>Back</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void submit('reveals_personal_details', undefined)}
                    style={({ pressed }) => [styles.destructive, pressed && styles.rowPressed]}
                    testID="flag-sheet.reveal-confirm"
                  >
                    <Text style={styles.primaryText}>Flag and log</Text>
                  </Pressable>
                </View>
              </>
            )}

            {step === 'submitting' && (
              <View style={styles.submitting} testID="flag-sheet.submitting">
                <ActivityIndicator color="#f5f5f5" />
                <Text style={styles.message}>Submitting…</Text>
              </View>
            )}
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
    gap: 6,
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
    marginBottom: 4,
  },
  row: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2a',
  },
  row2: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  rowPressed: { backgroundColor: '#1c1c1c' },
  rowText: { color: '#9ec5ff', fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: '#0a0a0a',
    color: '#f5f5f5',
    fontSize: 15,
    minHeight: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    textAlignVertical: 'top',
  },
  counter: { color: '#7a7a7a', fontSize: 12, paddingHorizontal: 4, textAlign: 'right' },
  error: { color: '#ff6b6b', fontSize: 13, paddingHorizontal: 4 },
  primary: {
    flex: 1,
    backgroundColor: '#9ec5ff',
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
  },
  primaryText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
  secondary: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  secondaryText: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  destructive: {
    flex: 1,
    backgroundColor: '#e06a6a',
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
  },
  cancelWrap: { marginTop: 8 },
  cancelRow: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  submitting: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 10,
  },
});
