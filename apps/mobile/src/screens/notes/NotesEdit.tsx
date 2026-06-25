import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const MAX_LENGTH = 4000; // matches NOTE_BODY_MAX

export interface NotesEditProps {
  /** Initial body to load into the editor. */
  readonly initialBody: string;
  readonly busy?: boolean;
  /** Resolves to an inline error string, or null on success.
   *  Rejecting leaves the form intact. */
  readonly onSubmit: (body: string) => Promise<string | null>;
  readonly onCancel: () => void;
}

/**
 * Presentational note editor. Body-only — attachments are not editable in
 * this surface. The route handles the kind-specific wire behaviour
 * (shared/secret-post-reveal emits an op; secret-pre-reveal is local-only).
 */
export function NotesEdit(props: NotesEditProps): JSX.Element {
  const [body, setBody] = useState(props.initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const tooLong = body.length > MAX_LENGTH;
  const unchanged = trimmed === props.initialBody.trim();
  const canSubmit = !busy && !props.busy && !tooLong && trimmed.length > 0 && !unchanged;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const errMessage = await props.onSubmit(trimmed);
      if (errMessage) setError(errMessage);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.notes-edit">
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.bar} edges={['top']}>
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={props.onCancel}
            testID="notes-edit.cancel"
          >
            <Text style={styles.barBtnGhost}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Edit note</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            hitSlop={12}
            onPress={() => void submit()}
            testID="notes-edit.save"
          >
            <Text style={[styles.barBtnSave, !canSubmit && styles.barBtnDisabled]}>Save</Text>
          </Pressable>
        </SafeAreaView>

        <TextInput
          style={styles.input}
          multiline
          autoFocus
          placeholder="Edit the body…"
          placeholderTextColor="#5a5a5a"
          value={body}
          onChangeText={setBody}
          maxLength={MAX_LENGTH + 1}
          testID="notes-edit.input"
        />
        <SafeAreaView style={styles.meta} edges={['bottom']}>
          <Text style={[styles.metaText, tooLong && styles.metaError]}>
            {body.length} / {MAX_LENGTH}
          </Text>
          {error != null ? (
            <Text style={styles.error} testID="notes-edit.error">
              {error}
            </Text>
          ) : null}
          {props.busy || busy ? (
            <ActivityIndicator color="#9ec5ff" testID="notes-edit.busy" />
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  fill: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { color: '#f5f5f5', fontSize: 17, fontWeight: '600' },
  barBtnGhost: { color: '#9e9e9e', fontSize: 16 },
  barBtnSave: { color: '#9ec5ff', fontSize: 16, fontWeight: '700' },
  barBtnDisabled: { color: '#3a3a3a' },
  input: {
    flex: 1,
    color: '#f5f5f5',
    fontSize: 17,
    lineHeight: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  meta: { paddingHorizontal: 16, paddingVertical: 10, alignItems: 'flex-end' },
  metaText: { color: '#7a7a7a', fontSize: 12 },
  metaError: { color: '#ffb4b4' },
  error: { color: '#ffb4b4', fontSize: 14, marginTop: 6 },
});
