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

import type { NoteKind } from '../../features/notes/store';

const MAX_LENGTH = 4000; // matches NOTE_BODY_MAX in connection-protocol

/** A media item staged on the compose form while it encrypts + uploads. */
export interface StagedMedia {
  readonly id: string;
  readonly mediaType: 'image' | 'audio';
  readonly status: 'preparing' | 'ready' | 'error';
  /** Surfaced when status is 'error', so a failed attachment shows *why*
   *  (e.g. "uploadBlob: Network request failed") instead of a bare "failed". */
  readonly error?: string;
}

export interface NotesComposeProps {
  /** Resolves to an error string to show inline, or null on success.
   *  Rejecting leaves the form intact with a generic message. */
  readonly onSubmit: (input: { kind: NoteKind; body: string }) => Promise<string | null>;
  readonly onCancel: () => void;
  /** When true and the note is secret, show a dismissible nudge to set a
   *  shared roleplay term. Purely informational — never gates saving. */
  readonly termNotSet?: boolean;
  /** Navigate to the roleplay-term flow (from the nudge). */
  readonly onSetTerm?: () => void;
  /** Media staged so far. Drives the chips + enables a media-only save.
   *  When the add-media handlers are omitted the whole media UI is hidden
   *  (keeps the component usable without the native wiring). */
  readonly staged?: readonly StagedMedia[];
  readonly isRecording?: boolean;
  readonly onAddPhoto?: () => void;
  readonly onTakePhoto?: () => void;
  readonly onToggleRecord?: () => void;
  readonly onRemoveMedia?: (id: string) => void;
}

/**
 * Presentational compose form for a new shared / secret note. The
 * route is responsible for stitching this to writeSharedNote /
 * writeSecretNote — this component knows nothing about the data
 * layer.
 */
export function NotesCompose(props: NotesComposeProps): JSX.Element {
  const [kind, setKind] = useState<NoteKind>('shared');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);

  const staged = props.staged ?? [];
  const mediaEnabled = props.onAddPhoto != null;
  const hasReadyMedia = staged.some((m) => m.status === 'ready');
  const anyPreparing = staged.some((m) => m.status === 'preparing');
  const tooShort = body.trim().length === 0;
  const tooLong = body.length > MAX_LENGTH;
  // A note needs SOME substance: text, or at least one uploaded attachment.
  // Block while media is still encrypting/uploading or a recording is live.
  const canSubmit =
    !busy && !tooLong && !anyPreparing && !props.isRecording && (!tooShort || hasReadyMedia);

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const errMessage = await props.onSubmit({ kind, body: body.trim() });
      if (errMessage) setError(errMessage);
    } catch (e) {
      setError((e as Error).message ?? 'Could not save note');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.notes-compose">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kbv}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={props.onCancel}
            testID="notes-compose.cancel"
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>New note</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={submit}
            testID="notes.submit"
            style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
          >
            {busy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.submitText}>Save</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.radioRow}>
          {(['shared', 'secret'] satisfies NoteKind[]).map((k) => (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ selected: kind === k }}
              testID={`notes.kind.${k}`}
              onPress={() => setKind(k)}
              style={[styles.radio, kind === k && styles.radioActive]}
            >
              <Text style={[styles.radioText, kind === k && styles.radioTextActive]}>
                {k === 'shared' ? 'Shared' : 'Secret'}
              </Text>
            </Pressable>
          ))}
        </View>

        {mediaEnabled ? (
          <View style={styles.mediaSection} testID="notes.media">
            <View style={styles.mediaButtons}>
              <Pressable
                accessibilityRole="button"
                onPress={props.onAddPhoto}
                testID="notes.add-photo"
                style={styles.mediaBtn}
              >
                <Text style={styles.mediaBtnText}>+ Photo</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={props.onTakePhoto}
                testID="notes.take-photo"
                style={styles.mediaBtn}
              >
                <Text style={styles.mediaBtnText}>Camera</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={props.onToggleRecord}
                testID="notes.record"
                style={[styles.mediaBtn, props.isRecording && styles.mediaBtnRecording]}
              >
                <Text style={styles.mediaBtnText}>{props.isRecording ? 'Stop' : 'Voice note'}</Text>
              </Pressable>
            </View>
            {staged.length > 0 ? (
              <View style={styles.chips}>
                {staged.map((m) => (
                  <View key={m.id} style={styles.chip} testID={`notes.media.chip.${m.id}`}>
                    <Text style={styles.chipLabel}>
                      {m.mediaType === 'image' ? 'Photo' : 'Voice'}
                    </Text>
                    {m.status === 'preparing' ? (
                      <ActivityIndicator color="#9ec5ff" size="small" />
                    ) : null}
                    {m.status === 'error' ? (
                      <Text style={styles.chipError} numberOfLines={1}>
                        {m.error ? `failed: ${m.error}` : 'failed'}
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => props.onRemoveMedia?.(m.id)}
                      testID={`notes.media.remove.${m.id}`}
                    >
                      <Text style={styles.chipRemove}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {kind === 'secret' && props.termNotSet && !promptDismissed ? (
          <View style={styles.prompt} testID="notes.term-prompt">
            <Text style={styles.promptText}>Set a shared roleplay term with your partner?</Text>
            <View style={styles.promptActions}>
              <Pressable
                accessibilityRole="button"
                onPress={props.onSetTerm}
                hitSlop={8}
                testID="notes.set-term"
              >
                <Text style={styles.promptLink}>Set one</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPromptDismissed(true)}
                hitSlop={8}
                testID="notes.dismiss-term"
              >
                <Text style={styles.promptDismiss}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={
            kind === 'shared'
              ? 'Write a note both of you can read…'
              : 'Write a secret. Body stays on your device until you tap Reveal.'
          }
          placeholderTextColor="#666"
          multiline
          maxLength={MAX_LENGTH}
          style={styles.input}
          testID="notes.body"
        />

        <View style={styles.statusRow}>
          <Text style={styles.counter}>
            {body.length} / {MAX_LENGTH}
          </Text>
          {tooLong ? (
            <Text style={styles.errorText} testID="notes-compose.too-long">
              Body exceeds {MAX_LENGTH} characters.
            </Text>
          ) : null}
          {error ? (
            <Text style={styles.errorText} testID="notes-compose.error">
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
  prompt: {
    marginHorizontal: 16,
    marginBottom: 4,
    padding: 12,
    backgroundColor: '#161616',
    borderRadius: 10,
    gap: 8,
  },
  promptText: { color: '#cfcfcf', fontSize: 13, lineHeight: 18 },
  promptActions: { flexDirection: 'row', gap: 18 },
  promptLink: { color: '#9ec5ff', fontSize: 14, fontWeight: '600' },
  promptDismiss: { color: '#7a7a7a', fontSize: 14, fontWeight: '600' },
  mediaSection: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  mediaButtons: { flexDirection: 'row', gap: 8 },
  mediaBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  mediaBtnRecording: { backgroundColor: '#5a1a1a' },
  mediaBtnText: { color: '#cfcfcf', fontWeight: '600', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#161616',
  },
  chipLabel: { color: '#cfcfcf', fontSize: 13 },
  chipError: { color: '#ffb4b4', fontSize: 12 },
  chipRemove: { color: '#9e9e9e', fontSize: 14, fontWeight: '700' },
});
