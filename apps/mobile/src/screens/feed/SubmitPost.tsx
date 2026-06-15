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

import type { PostAudience, PostContentType, PostInput } from '@secretnotebook/shared-types';

const AUDIENCES = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'masculine', label: 'Masculine' },
  { value: 'feminine', label: 'Feminine' },
] satisfies ReadonlyArray<{ value: PostAudience; label: string }>;

export interface SubmitPostProps {
  /** Called when the user submits a valid post. Resolves to an error
   *  string to show inline; rejects to leave the form intact with a
   *  generic error. */
  readonly onSubmit: (input: PostInput) => Promise<string | null>;
  readonly onCancel: () => void;
  /** The device's own not-yet-published notes, offered as one-tap publish
   *  targets. Empty/omitted hides the section (e.g. unpaired devices). */
  readonly notes?: ReadonlyArray<{ id: string; preview: string }>;
  /** Publish an existing note to the global feed with the chosen audience.
   *  Returns an error string, or null on success (the route navigates away). */
  readonly onPublishNote?: (id: string, audience: PostAudience) => Promise<string | null>;
}

const MAX_LENGTH = 4000;

export function SubmitPost(props: SubmitPostProps): JSX.Element {
  const [contentType, setContentType] = useState<PostContentType>('text');
  const [audience, setAudience] = useState<PostAudience>('everyone');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const notes = props.notes ?? [];

  async function publishNoteById(id: string): Promise<void> {
    if (!props.onPublishNote || publishingId !== null) return;
    setPublishingId(id);
    setError(null);
    try {
      const errMessage = await props.onPublishNote(id, audience);
      if (errMessage) setError(errMessage);
    } catch (e) {
      setError((e as Error).message ?? 'Could not publish note');
    } finally {
      setPublishingId(null);
    }
  }

  const tooShort = body.trim().length === 0;
  const tooLong = body.length > MAX_LENGTH;
  const canSubmit = !busy && !tooShort && !tooLong;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const errMessage = await props.onSubmit({ contentType, body: body.trim(), audience });
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

        {props.onPublishNote && notes.length > 0 ? (
          <View style={styles.notesSection}>
            <Text style={styles.sectionLabel}>PUBLISH A NOTE</Text>
            {notes.map((n) => (
              <Pressable
                key={n.id}
                accessibilityRole="button"
                disabled={publishingId !== null}
                onPress={() => void publishNoteById(n.id)}
                style={styles.noteRow}
                testID={`submit-post.note.${n.id}`}
              >
                <Text style={styles.noteRowText} numberOfLines={1}>
                  {n.preview}
                </Text>
                {publishingId === n.id ? (
                  <ActivityIndicator color="#9ec5ff" />
                ) : (
                  <Text style={styles.noteRowCta}>Publish</Text>
                )}
              </Pressable>
            ))}
            <Text style={styles.sectionLabel}>OR WRITE A NEW POST</Text>
          </View>
        ) : null}

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

        <View style={styles.radioRow}>
          {AUDIENCES.map((a) => (
            <Pressable
              key={a.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: audience === a.value }}
              testID={`submit-post.audience.${a.value}`}
              onPress={() => setAudience(a.value)}
              style={[styles.radio, audience === a.value && styles.radioActive]}
            >
              <Text style={[styles.radioText, audience === a.value && styles.radioTextActive]}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.audienceHint}>Who it's for — drives the role filter on the feed.</Text>

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
  notesSection: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  sectionLabel: { color: '#7a7a7a', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#161616',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noteRowText: { color: '#f5f5f5', fontSize: 15, flex: 1 },
  noteRowCta: { color: '#9ec5ff', fontSize: 14, fontWeight: '600' },
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
  audienceHint: { color: '#7a7a7a', fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
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
