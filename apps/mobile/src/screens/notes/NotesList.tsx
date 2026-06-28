import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '../../components/ScreenHeader';
import type { PendingNoteRow } from '../../features/notes/pending-store';
import type { NoteRow } from '../../features/notes/store';

export interface NotesListProps {
  readonly items: ReadonlyArray<NoteRow>;
  /** Pre-pairing / pre-engine drafts (the `pending_note` table). Shown above
   *  the notes list with a DRAFT badge so they don't appear to vanish; tapping
   *  one opens a sheet to share or discard it. */
  readonly drafts: ReadonlyArray<PendingNoteRow>;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  /** Whether this device is paired with a partner. */
  readonly paired: boolean;
  readonly onRefresh: () => void;
  readonly onSelectNote: (id: string) => void;
  /** Open the actions sheet (share / discard) for a draft. */
  readonly onSelectDraft: (id: string) => void;
  readonly onCompose: () => void;
  /** Open the pairing modal (from the unpaired banner). */
  readonly onPair: () => void;
}

function isoDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

function previewBody(row: NoteRow): string {
  if (row.kind === 'secret' && row.body == null) {
    return 'Locked — waiting for reveal';
  }
  return (row.body ?? '').slice(0, 140);
}

/**
 * Notes home — the app's landing surface. Hamburger menu in the header,
 * a compose-forward "Write a note…" tile up top (Apple-Notes style), an
 * unpaired banner that leads into pairing, and the list of notes below.
 */
export function NotesList(props: NotesListProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.notes">
      <ScreenHeader title="Notes" />

      {!props.paired && (
        <Pressable
          accessibilityRole="button"
          style={styles.banner}
          onPress={props.onPair}
          testID="notes.pair_banner"
        >
          <Text style={styles.bannerText}>
            You're not paired with a partner. Pair with one other person to share your notes.
          </Text>
        </Pressable>
      )}

      <Pressable
        accessibilityRole="button"
        style={styles.composeTile}
        onPress={props.onCompose}
        testID="notes.compose"
      >
        <Text style={styles.composeTileText}>Write a note…</Text>
      </Pressable>

      <FlatList
        data={props.items as NoteRow[]}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl
            refreshing={props.isRefreshing}
            onRefresh={props.onRefresh}
            tintColor="#f5f5f5"
          />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          props.drafts.length > 0 ? (
            <View testID="notes.drafts">
              <Text style={styles.draftsHeader}>DRAFTS</Text>
              {props.drafts.map((d) => (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  testID={`notes.draft.${d.id}`}
                  onPress={() => props.onSelectDraft(d.id)}
                  style={styles.row}
                >
                  <View style={styles.rowTopRow}>
                    <Text style={[styles.kindBadge, d.kind === 'secret' && styles.kindBadgeSecret]}>
                      {d.kind.toUpperCase()}
                    </Text>
                    <Text style={styles.draftBadge}>DRAFT</Text>
                  </View>
                  <Text style={styles.rowBody} numberOfLines={3}>
                    {d.body.slice(0, 140)}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {isoDate(d.createdAt)} ·{' '}
                    {props.paired ? 'tap to share or discard' : 'tap to discard, or pair to share'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            testID={`notes.row.${item.id}`}
            onPress={() => props.onSelectNote(item.id)}
            style={styles.row}
          >
            <View style={styles.rowTopRow}>
              <Text
                style={[styles.kindBadge, item.kind === 'secret' && styles.kindBadgeSecret]}
                testID={`notes.row.${item.id}.kind`}
              >
                {item.kind.toUpperCase()}
              </Text>
              {item.publishedAt != null ? (
                <Text style={styles.publishedBadge} testID={`notes.row.${item.id}.published`}>
                  PUBLISHED
                </Text>
              ) : null}
            </View>
            {item.title ? (
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
            ) : null}
            <Text style={styles.rowBody} numberOfLines={2}>
              {previewBody(item)}
            </Text>
            <Text style={styles.rowMeta}>{isoDate(item.createdAt)}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          props.isLoading ? (
            <View style={styles.center} testID="notes.loading">
              <ActivityIndicator color="#f5f5f5" />
            </View>
          ) : props.drafts.length > 0 ? null : (
            <View style={styles.empty} testID="notes.empty">
              <Text style={styles.emptyTitle}>No notes yet</Text>
              <Text style={styles.emptyBody}>Tap “Write a note…” to start.</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  banner: {
    backgroundColor: '#1c1c2a',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
  },
  bannerText: { color: '#9ec5ff', fontSize: 13, lineHeight: 18 },
  composeTile: {
    backgroundColor: '#161616',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  composeTileText: { color: '#9a9a9a', fontSize: 16 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    backgroundColor: '#161616',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    gap: 6,
  },
  rowTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kindBadge: { color: '#9ec5ff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  kindBadgeSecret: { color: '#ffb4b4' },
  publishedBadge: { color: '#9eff9e', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  draftBadge: { color: '#e0c080', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  draftsHeader: {
    color: '#7a7a7a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 4,
  },
  rowTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600', lineHeight: 20 },
  rowBody: { color: '#b0b0b0', fontSize: 14, lineHeight: 19 },
  rowMeta: { color: '#808080', fontSize: 12 },
  empty: { paddingTop: 80, alignItems: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  emptyBody: { color: '#808080', fontSize: 14, textAlign: 'center' },
  center: { paddingTop: 32, alignItems: 'center' },
});
