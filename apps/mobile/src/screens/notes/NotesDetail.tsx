import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NoteRow } from '../../features/notes/store';
import { AudioPlayer } from './AudioPlayer';
import { ImageViewerModal } from './ImageViewerModal';

/** One attachment as the detail screen needs to render it. `previewUri` is the
 *  DECRYPTED cache file (set after the user loads it); until then we show a
 *  load/spinner/retry control driven by `state`. */
export interface DetailAttachment {
  readonly id: string;
  readonly mediaType: 'image' | 'audio';
  readonly state: 'pending' | 'ready' | 'remote' | 'downloading' | 'failed';
  readonly previewUri: string | null;
  /** Natural pixel dimensions (image) for aspect-ratio rendering; may be null
   *  on older rows. */
  readonly width?: number | null;
  readonly height?: number | null;
  /** Clip length (audio) in ms, for the player's total-time before load. */
  readonly durationMs?: number | null;
}

export interface NotesDetailProps {
  readonly note: NoteRow | null;
  readonly isLoading: boolean;
  readonly isAuthor: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onReveal: (message: string) => void;
  readonly onOpenPublishedPost: (id: string) => void;
  readonly attachments?: readonly DetailAttachment[];
  /** Download (if needed) + decrypt the attachment to a preview file. */
  readonly onOpenAttachment?: (id: string) => void;
  /** True when the viewer is allowed to edit. Shared notes: either partner;
   *  secret notes: original author only. The route computes this. */
  readonly canEdit?: boolean;
  /** True when the viewer is allowed to delete (author only, both kinds). */
  readonly canDelete?: boolean;
  /** Navigate to the edit screen for this note. */
  readonly onEdit?: () => void;
  /** Confirm + perform the delete. */
  readonly onDelete?: () => void;
}

function isoDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

/**
 * Presentational note detail. Author affordances (Reveal / Publish)
 * are surfaced only when `isAuthor`; the route decides authorship by
 * byte-comparing the row's authorPubkey to the engine's selfPub.
 */
export function NotesDetail(props: NotesDetailProps): JSX.Element {
  const { note } = props;
  const insets = useSafeAreaInsets();
  // Index into the photo array currently open full-screen, or null.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [revealConfirming, setRevealConfirming] = useState(false);
  const [revealMessage, setRevealMessage] = useState('');
  const hasMenu = (props.canEdit || props.canDelete) && note != null && note.deletedAt == null;
  const imageUris: string[] = (props.attachments ?? [])
    .filter((a) => a.mediaType === 'image' && a.previewUri != null)
    .map((a) => a.previewUri as string);

  return (
    <SafeAreaView style={styles.container} testID="screen.notes-detail">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="notes-detail.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        {hasMenu && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Note options"
            hitSlop={12}
            onPress={() => setMenuOpen(true)}
            testID="notes-detail.options"
          >
            <Text style={styles.optionsGlyph}>⋯</Text>
          </Pressable>
        )}
      </View>

      {/* Overflow options menu */}
      {hasMenu && (
        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
            <View style={[styles.menuPanel, { top: insets.top + 56, right: insets.right + 16 }]}>
              {props.canEdit && props.onEdit && (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.busy}
                  onPress={() => {
                    setMenuOpen(false);
                    props.onEdit?.();
                  }}
                  style={styles.menuItem}
                  testID="notes-detail.edit"
                >
                  <Text style={styles.menuItemText}>Edit</Text>
                </Pressable>
              )}
              {props.canDelete && props.onDelete && (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.busy}
                  onPress={() => {
                    setMenuOpen(false);
                    props.onDelete?.();
                  }}
                  style={styles.menuItem}
                  testID="notes-detail.delete"
                >
                  <Text style={styles.menuItemTextDestructive}>Delete</Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        </Modal>
      )}

      {props.isLoading && !note ? (
        <View style={styles.center} testID="notes-detail.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      ) : null}

      {!props.isLoading && !note ? (
        <View style={styles.center} testID="notes-detail.missing">
          <Text style={styles.errorText}>This note is no longer available.</Text>
        </View>
      ) : null}

      {note ? (
        <View style={styles.content}>
          <Text style={styles.meta}>
            {note.kind.toUpperCase()} · {isoDate(note.createdAt)}
          </Text>

          {note.body != null ? (
            <Text style={styles.body} testID="notes-detail.body">
              {note.body}
            </Text>
          ) : note.kind === 'secret' ? (
            <Text style={styles.locked} testID="notes-detail.locked">
              Locked — waiting for the author to reveal this secret.
            </Text>
          ) : null}

          {props.attachments && props.attachments.length > 0 ? (
            <View style={styles.media} testID="notes-detail.media">
              {props.attachments.map((a) => {
                if (a.previewUri && a.mediaType === 'image') {
                  // Render at the photo's real aspect ratio (flexible box, not
                  // a fixed landscape crop); tap to open the full-screen viewer.
                  const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
                  const imgIdx = imageUris.indexOf(a.previewUri);
                  return (
                    <Pressable
                      key={a.id}
                      accessibilityRole="imagebutton"
                      accessibilityLabel="Open photo full screen"
                      onPress={() => setViewerIndex(imgIdx >= 0 ? imgIdx : 0)}
                      testID={`notes-detail.image.${a.id}`}
                    >
                      <Image
                        source={{ uri: a.previewUri }}
                        style={[styles.image, { aspectRatio: ratio }]}
                        resizeMode="cover"
                      />
                    </Pressable>
                  );
                }
                if (a.previewUri && a.mediaType === 'audio') {
                  return <AudioPlayer key={a.id} uri={a.previewUri} durationMs={a.durationMs} />;
                }
                if (a.state === 'downloading') {
                  return (
                    <View key={a.id} style={styles.mediaButton}>
                      <ActivityIndicator color="#9ec5ff" />
                    </View>
                  );
                }
                return (
                  <Pressable
                    key={a.id}
                    accessibilityRole="button"
                    onPress={() => props.onOpenAttachment?.(a.id)}
                    style={styles.mediaButton}
                    testID={`notes-detail.load.${a.id}`}
                  >
                    <Text style={styles.mediaButtonText}>
                      {a.state === 'failed'
                        ? 'Retry'
                        : a.mediaType === 'image'
                          ? 'Load photo'
                          : 'Load voice note'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {note.publishedAt != null && note.publishedGlobalPostId != null ? (
            <Pressable
              accessibilityRole="button"
              testID="notes-detail.published-badge"
              onPress={() => props.onOpenPublishedPost(note.publishedGlobalPostId as string)}
              style={styles.publishedBadge}
            >
              <Text style={styles.publishedBadgeText}>Published to global feed · tap to open</Text>
              <Text style={styles.publishedBadgeMeta} numberOfLines={1}>
                {note.publishedGlobalPostId}
              </Text>
            </Pressable>
          ) : null}

          {props.isAuthor && note.kind === 'secret' && note.revealedAt == null ? (
            <View style={styles.actionRow}>
              {revealConfirming ? (
                <>
                  <Text style={styles.revealPrompt}>Why are you revealing this? (optional)</Text>
                  <TextInput
                    style={styles.revealInput}
                    value={revealMessage}
                    onChangeText={setRevealMessage}
                    placeholder="A message to your partner…"
                    placeholderTextColor="#5e5e5e"
                    multiline
                    testID="notes-detail.reveal-message"
                    editable={!props.busy}
                  />
                  <View style={styles.revealButtons}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={props.busy}
                      onPress={() => {
                        setRevealConfirming(false);
                        setRevealMessage('');
                      }}
                      style={styles.revealCancelBtn}
                      testID="notes-detail.reveal-cancel"
                    >
                      <Text style={styles.revealCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={props.busy}
                      onPress={() => {
                        props.onReveal(revealMessage);
                        setRevealConfirming(false);
                        setRevealMessage('');
                      }}
                      style={[
                        styles.actionButton,
                        { flex: 1 },
                        props.busy && styles.actionDisabled,
                      ]}
                      testID="notes-detail.reveal-confirm"
                    >
                      <Text style={styles.actionText}>Confirm reveal</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.busy}
                  onPress={() => setRevealConfirming(true)}
                  testID="notes-detail.reveal"
                  style={[styles.actionButton, props.busy && styles.actionDisabled]}
                >
                  <Text style={styles.actionText}>Reveal to partner</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {props.error ? (
            <Text style={styles.errorText} testID="notes-detail.error">
              {props.error}
            </Text>
          ) : null}
        </View>
      ) : null}

      <ImageViewerModal
        uris={imageUris}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
        onChangeIndex={setViewerIndex}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  back: { color: '#9ec5ff', fontSize: 15 },
  optionsGlyph: { color: '#f5f5f5', fontSize: 22, fontWeight: '600', paddingHorizontal: 4 },
  menuBackdrop: { flex: 1 },
  menuPanel: {
    position: 'absolute',
    backgroundColor: '#222222',
    borderRadius: 10,
    overflow: 'hidden',
    minWidth: 140,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  menuItem: { paddingVertical: 14, paddingHorizontal: 18 },
  menuItemText: { color: '#f5f5f5', fontSize: 16 },
  menuItemTextDestructive: { color: '#ffb4b4', fontSize: 16 },
  content: { padding: 16, gap: 16 },
  meta: { color: '#808080', fontSize: 12, letterSpacing: 0.5 },
  body: { color: '#f5f5f5', fontSize: 17, lineHeight: 24 },
  locked: { color: '#9e9e9e', fontSize: 15, fontStyle: 'italic' },
  publishedBadge: {
    backgroundColor: '#1a2a1a',
    padding: 12,
    borderRadius: 10,
    gap: 4,
  },
  publishedBadgeText: { color: '#9eff9e', fontSize: 13, fontWeight: '600' },
  publishedBadgeMeta: { color: '#5e8e5e', fontSize: 11 },
  media: { gap: 12 },
  // aspectRatio is supplied inline from the photo's real dimensions; maxHeight
  // keeps a tall portrait from dominating the scroll (the viewer shows it whole).
  image: { width: '100%', maxHeight: 420, borderRadius: 10, backgroundColor: '#161616' },
  mediaButton: {
    backgroundColor: '#161616',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  mediaButtonText: { color: '#9ec5ff', fontWeight: '600', fontSize: 14 },
  actionRow: { gap: 12, paddingTop: 8 },
  revealPrompt: { color: '#a0a0a0', fontSize: 14 },
  revealInput: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f5f5f5',
    fontSize: 15,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  revealButtons: { flexDirection: 'row', gap: 10 },
  revealCancelBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revealCancelText: { color: '#a0a0a0', fontWeight: '600', fontSize: 15 },
  actionButton: {
    backgroundColor: '#9ec5ff',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionDisabled: { backgroundColor: '#2a2a2a' },
  actionText: { color: '#0a0a0a', fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  errorText: { color: '#ffb4b4', fontSize: 14 },
});
