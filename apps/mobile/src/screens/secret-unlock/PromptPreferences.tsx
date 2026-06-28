import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  DEFAULT_VISIBLE_CATEGORIES,
  PROMPT_CATEGORIES,
  type PromptCategory,
} from '../../features/secret-unlock/categories';

export interface PromptPreferencesProps {
  readonly enabled: ReadonlySet<PromptCategory>;
  readonly isSaving: boolean;
  readonly dirty: boolean;
  readonly onToggle: (category: PromptCategory) => void;
  readonly onSave: () => void;
  readonly onBack: () => void;
}

/**
 * Prompt-category preferences screen. The collapsed view shows the 6
 * most-common categories; the rest land behind a "Show more" toggle, so
 * the first scroll stays short for the common case.
 *
 * The draw filter uses these categories at unlock-start: a prompt only
 * fires when both partners have at least one of its category tags on.
 * That's surfaced inline at the top so the user understands the
 * mutual-consent shape.
 */
export function PromptPreferences(props: PromptPreferencesProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? PROMPT_CATEGORIES : DEFAULT_VISIBLE_CATEGORIES;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.prompt_preferences">
      <View style={styles.bar}>
        <Pressable
          hitSlop={12}
          onPress={props.onBack}
          style={styles.barBtn}
          testID="prompt-prefs.back"
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Prompt preferences</Text>
        <View style={styles.barBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Pick the kinds of prompts you want to see. Unlock prompts are drawn from categories you
          AND your partner both have on — if you want the prompt, they have to want it too.
        </Text>

        {visible.map((cat) => {
          const isOn = props.enabled.has(cat);
          return (
            <Pressable
              key={cat}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isOn }}
              onPress={() => props.onToggle(cat)}
              testID={`prompt-prefs.row.${cat}`}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={[styles.check, isOn && styles.checkOn]}>
                {isOn && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{CATEGORY_LABELS[cat]}</Text>
                <Text style={styles.rowDesc}>{CATEGORY_DESCRIPTIONS[cat]}</Text>
              </View>
            </Pressable>
          );
        })}

        {!showAll && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAll(true)}
            testID="prompt-prefs.show-more"
            style={({ pressed }) => [styles.showMore, pressed && styles.rowPressed]}
          >
            <Text style={styles.showMoreText}>
              Show more ({PROMPT_CATEGORIES.length - DEFAULT_VISIBLE_CATEGORIES.length})
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={!props.dirty || props.isSaving}
          onPress={props.onSave}
          testID="prompt-prefs.save"
          style={[styles.saveBtn, (!props.dirty || props.isSaving) && styles.saveBtnDisabled]}
        >
          <Text style={styles.saveBtnText}>{props.isSaving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  barBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { color: '#f5f5f5', fontSize: 34, lineHeight: 36 },
  title: { color: '#f5f5f5', fontSize: 20, fontWeight: '700', flex: 1, textAlign: 'center' },
  scroll: { padding: 16, gap: 8, paddingBottom: 120 },
  intro: { color: '#b5b5b5', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 14,
    backgroundColor: '#141414',
    borderRadius: 10,
  },
  rowPressed: { backgroundColor: '#1c1c1c' },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#5a5a5a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkOn: { backgroundColor: '#9ec5ff', borderColor: '#9ec5ff' },
  checkMark: { color: '#0a0a0a', fontSize: 16, fontWeight: '700', lineHeight: 18 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  rowDesc: { color: '#9e9e9e', fontSize: 13, lineHeight: 18 },
  showMore: { paddingVertical: 14, alignItems: 'center', borderRadius: 10, marginTop: 6 },
  showMoreText: { color: '#9ec5ff', fontSize: 15, fontWeight: '600' },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0a0a0a',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2a',
  },
  saveBtn: {
    backgroundColor: '#9ec5ff',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#2a2a2a' },
  saveBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
});
