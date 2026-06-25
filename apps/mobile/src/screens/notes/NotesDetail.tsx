import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  readonly onReveal: () => void;
  readonly onOpenPublishedPost: (id: string) => void;
  readonly attachments?: readonly DetailAttachment[];
  /** Download (if needed) + decrypt the attachment to a preview file. */
  readonly onOpenAttachment?: (id: string) => void;
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
  // URI of the photo currently open full-screen, or null.
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container} testID="screen.notes-detail">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="notes-detail.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
      </View>

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
                  return (
                    <Pressable
                      key={a.id}
                      accessibilityRole="imagebutton"
                      accessibilityLabel="Open photo full screen"
                      onPress={() => setViewerUri(a.previewUri)}
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
              <Pressable
                accessibilityRole="button"
                disabled={props.busy}
                onPress={props.onReveal}
                testID="notes-detail.reveal"
                style={[styles.actionButton, props.busy && styles.actionDisabled]}
              >
                <Text style={styles.actionText}>Reveal to partner</Text>
              </Pressable>
            </View>
          ) : null}

          {props.error ? (
            <Text style={styles.errorText} testID="notes-detail.error">
              {props.error}
            </Text>
          ) : null}
        </View>
      ) : null}

      <ImageViewerModal uri={viewerUri} onClose={() => setViewerUri(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  back: { color: '#9ec5ff', fontSize: 15 },
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
  actionRow: { gap: 10, paddingTop: 8 },
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
