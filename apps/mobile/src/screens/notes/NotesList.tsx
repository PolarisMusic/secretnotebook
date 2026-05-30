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

import type { NoteRow } from '../../features/notes/store';

export interface NotesListProps {
  readonly items: ReadonlyArray<NoteRow>;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onSelectNote: (id: string) => void;
  readonly onCompose: () => void;
  readonly onBack: () => void;
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
 * Presentational notes list. State + side-effects live in
 * NotesListRoute, which wires `listNotes(exec)` and re-reads on
 * pull-to-refresh.
 */
export function NotesList(props: NotesListProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.notes">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="notes.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Notes</Text>
        <Pressable
          accessibilityRole="button"
          testID="notes.compose"
          onPress={props.onCompose}
          style={styles.composeButton}
        >
          <Text style={styles.composeButtonText}>+ Note</Text>
        </Pressable>
      </View>

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
            <Text style={styles.rowBody} numberOfLines={3}>
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
          ) : (
            <View style={styles.empty} testID="notes.empty">
              <Text style={styles.emptyTitle}>No notes yet</Text>
              <Text style={styles.emptyBody}>Tap “+ Note” to write a shared or secret note.</Text>
            </View>
          )
        }
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
    paddingBottom: 12,
  },
  back: { color: '#9ec5ff', fontSize: 15, minWidth: 60 },
  title: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  composeButton: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  composeButtonText: { color: '#f5f5f5', fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    backgroundColor: '#161616',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    gap: 6,
  },
  rowTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kindBadge: {
    color: '#9ec5ff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  kindBadgeSecret: { color: '#ffb4b4' },
  publishedBadge: {
    color: '#9eff9e',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rowBody: { color: '#f5f5f5', fontSize: 15, lineHeight: 20 },
  rowMeta: { color: '#808080', fontSize: 12 },
  empty: { paddingTop: 80, alignItems: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  emptyBody: { color: '#808080', fontSize: 14, textAlign: 'center' },
  center: { paddingTop: 32, alignItems: 'center' },
});
