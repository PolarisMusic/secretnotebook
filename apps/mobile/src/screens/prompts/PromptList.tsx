import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface PromptListItem {
  readonly promptId: string;
  readonly libraryKey: string;
  readonly title: string;
  /** Trimmed for the row; full body shown on detail. */
  readonly body: string;
  /** seconds since epoch — used for the meta line. */
  readonly createdAtHint?: number;
}

export interface PromptListSection {
  readonly key: 'assigned-to-me' | 'awaiting-my-cert';
  readonly title: string;
  readonly emptyHint: string;
  readonly data: ReadonlyArray<PromptListItem>;
}

export interface PromptListProps {
  readonly sections: ReadonlyArray<PromptListSection>;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isAssigning: boolean;
  /** Optional inline error message after a failed assign. */
  readonly assignError: string | null;
  readonly onRefresh: () => void;
  readonly onBack: () => void;
  readonly onSelect: (section: PromptListSection['key'], item: PromptListItem) => void;
  readonly onAssign: () => void | Promise<void>;
}

const SECTION_ORDER: ReadonlyArray<PromptListSection['key']> = [
  'assigned-to-me',
  'awaiting-my-cert',
];

void FlatList; // imported only because the SectionList types reference it on RN < 0.75

export function PromptList(props: PromptListProps): JSX.Element {
  const ordered = [...props.sections].sort(
    (a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key),
  );
  return (
    <SafeAreaView style={styles.container} testID="screen.prompt-list">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="prompt-list.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Prompts</Text>
        <Pressable
          accessibilityRole="button"
          disabled={props.isAssigning}
          onPress={props.onAssign}
          testID="prompt-list.assign"
          style={[styles.assignButton, props.isAssigning && styles.assignDisabled]}
        >
          {props.isAssigning ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.assignText}>Assign</Text>
          )}
        </Pressable>
      </View>

      {props.assignError ? (
        <Text style={styles.errorLine} testID="prompt-list.assign-error">
          {props.assignError}
        </Text>
      ) : null}

      {props.isLoading ? (
        <View style={styles.center} testID="prompt-list.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      ) : (
        <SectionList
          sections={ordered as PromptListSection[]}
          keyExtractor={(item) => item.promptId}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={props.isRefreshing}
              onRefresh={props.onRefresh}
              tintColor="#f5f5f5"
            />
          }
          renderSectionHeader={({ section }) => (
            <Text
              style={styles.sectionHeader}
              testID={`prompt-list.section.${(section as PromptListSection).key}`}
            >
              {(section as PromptListSection).title}
            </Text>
          )}
          renderItem={({ section, item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onSelect((section as PromptListSection).key, item)}
              testID={`prompt-list.row.${item.promptId}`}
              style={styles.row}
            >
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.rowBody} numberOfLines={2}>
                {item.body}
              </Text>
            </Pressable>
          )}
          renderSectionFooter={({ section }) => {
            const s = section as PromptListSection;
            if (s.data.length > 0) return null;
            return (
              <Text style={styles.sectionEmpty} testID={`prompt-list.empty.${s.key}`}>
                {s.emptyHint}
              </Text>
            );
          }}
        />
      )}
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
  back: { color: '#9ec5ff', fontSize: 15 },
  title: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  assignButton: {
    backgroundColor: '#9ec5ff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  assignDisabled: { backgroundColor: '#2a2a2a' },
  assignText: { color: '#0a0a0a', fontWeight: '600' },
  errorLine: {
    color: '#ffb4b4',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 8,
    textAlign: 'center',
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  sectionHeader: {
    color: '#9e9e9e',
    fontSize: 13,
    letterSpacing: 0.5,
    paddingTop: 16,
    paddingBottom: 6,
    textTransform: 'uppercase',
  },
  sectionEmpty: {
    color: '#5e5e5e',
    fontSize: 13,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  row: {
    backgroundColor: '#161616',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    gap: 6,
  },
  rowTitle: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  rowBody: { color: '#9e9e9e', fontSize: 13, lineHeight: 18 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
