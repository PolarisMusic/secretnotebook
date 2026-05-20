import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PostContentType, PostInput } from '@secretnotebook/shared-types';

export interface SubmitPostProps {
  /** Called when the user submits a valid post. Resolves to an error
   *  string to show inline; rejects to leave the form intact with a
   *  generic error. */
  readonly onSubmit: (input: PostInput) => Promise<string | null>;
  readonly onCancel: () => void;
}

const MAX_LENGTH = 4000;

export function SubmitPost(props: SubmitPostProps): JSX.Element {
  const [contentType, setContentType] = useState<PostContentType>('text');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = body.trim().length === 0;
  const tooLong = body.length > MAX_LENGTH;
  const canSubmit = !busy && !tooShort && !tooLong;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const errMessage = await props.onSubmit({ contentType, body: body.trim() });
      if (errMessage) setError(errMessage);
    } catch (e) {
      setError((e as Error).message ?? 'Could not submit post');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.submit-post">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kbv}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={props.onCancel}
            testID="submit-post.cancel"
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>New post</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={submit}
            testID="submit-post.submit"
            style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
          >
            {busy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.submitText}>Post</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.radioRow}>
          {(['text', 'link'] satisfies PostContentType[]).map((kind) => (
            <Pressable
              key={kind}
              accessibilityRole="radio"
              accessibilityState={{ selected: contentType === kind }}
              testID={`submit-post.type.${kind}`}
              onPress={() => setContentType(kind)}
              style={[styles.radio, contentType === kind && styles.radioActive]}
            >
              <Text style={[styles.radioText, contentType === kind && styles.radioTextActive]}>
                {kind === 'text' ? 'Text' : 'Link'}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={contentType === 'text' ? 'Share something…' : 'https://…'}
          placeholderTextColor="#666"
          multiline
          autoCapitalize={contentType === 'link' ? 'none' : 'sentences'}
          autoCorrect={contentType === 'text'}
          maxLength={MAX_LENGTH}
          style={styles.input}
          testID="submit-post.body"
        />

        <View style={styles.statusRow}>
          <Text style={styles.counter}>
            {body.length} / {MAX_LENGTH}
          </Text>
          {tooLong ? (
            <Text style={styles.errorText} testID="submit-post.too-long">
              Body exceeds {MAX_LENGTH} characters.
            </Text>
          ) : null}
          {error ? (
            <Text style={styles.errorText} testID="submit-post.error">
              {error}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  kbv: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  cancel: { color: '#9ec5ff', fontSize: 15 },
  submitButton: {
    backgroundColor: '#9ec5ff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: '#2a2a2a' },
  submitText: { color: '#0a0a0a', fontWeight: '600' },
  radioRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  radio: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
  },
  radioActive: { backgroundColor: '#9ec5ff' },
  radioText: { color: '#9e9e9e', fontWeight: '600' },
  radioTextActive: { color: '#0a0a0a' },
  input: {
    flex: 1,
    margin: 16,
    padding: 14,
    backgroundColor: '#161616',
    color: '#f5f5f5',
    fontSize: 15,
    lineHeight: 20,
    borderRadius: 10,
    textAlignVertical: 'top',
  },
  statusRow: { paddingHorizontal: 16, paddingBottom: 16, gap: 6 },
  counter: { color: '#666', fontSize: 12, textAlign: 'right' },
  errorText: { color: '#ffb4b4', fontSize: 13 },
});
