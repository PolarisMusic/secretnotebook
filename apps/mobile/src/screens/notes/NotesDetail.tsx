import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { NoteRow } from '../../features/notes/store';

export interface NotesDetailProps {
  readonly note: NoteRow | null;
  readonly isLoading: boolean;
  readonly isAuthor: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onReveal: () => void;
  readonly onOpenPublishedPost: (id: string) => void;
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

          {note.body == null ? (
            <Text style={styles.locked} testID="notes-detail.locked">
              Locked — waiting for the author to reveal this secret.
            </Text>
          ) : (
            <Text style={styles.body} testID="notes-detail.body">
              {note.body}
            </Text>
          )}

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
