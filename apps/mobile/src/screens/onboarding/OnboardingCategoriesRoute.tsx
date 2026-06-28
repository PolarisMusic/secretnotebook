import { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  DEFAULT_VISIBLE_CATEGORIES,
  PROMPT_CATEGORIES,
  type PromptCategory,
} from '../../features/secret-unlock/categories';
import {
  getPromptCategories,
  setMyPromptCategories,
} from '../../features/secret-unlock/preferences-store';
import type { MainStackParamList } from '../../navigation/MainStack';

type Nav = NativeStackNavigationProp<MainStackParamList>;

export function OnboardingCategoriesRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [enabled, setEnabled] = useState<Set<PromptCategory> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!exec || !engine) {
      setEnabled(new Set(PROMPT_CATEGORIES));
      return;
    }
    let cancelled = false;
    void getPromptCategories(exec, engine.selfPub).then((set) => {
      if (!cancelled) setEnabled(set);
    });
    return () => {
      cancelled = true;
    };
  }, [exec, engine]);

  const goNext = useCallback(() => {
    navigation.navigate('OnboardingSafeWord');
  }, [navigation]);

  const onToggle = useCallback((cat: PromptCategory) => {
    setEnabled((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
    setDirty(true);
  }, []);

  const onContinue = useCallback(async () => {
    if (busy) return;
    if (!dirty || !exec || !engine || !enabled) {
      goNext();
      return;
    }
    setBusy(true);
    try {
      await setMyPromptCategories(
        { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
        [...enabled],
      );
    } finally {
      setBusy(false);
      goNext();
    }
  }, [busy, dirty, exec, engine, enabled, goNext]);

  const visible = showAll ? PROMPT_CATEGORIES : DEFAULT_VISIBLE_CATEGORIES;

  return (
    <SafeAreaView style={styles.container} testID="screen.onboarding-categories">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>Step 2 of 3</Text>
        <Text style={styles.title}>Your categories</Text>
        <Text style={styles.body}>
          Choose which types of prompts appear when you start a Prompts session. Both partners
          must have a category enabled for it to appear.
        </Text>

        {enabled == null ? (
          <ActivityIndicator color="#9ec5ff" style={styles.loader} />
        ) : (
          <View style={styles.list}>
            {visible.map((cat) => {
              const isOn = enabled.has(cat);
              return (
                <Pressable
                  key={cat}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isOn }}
                  onPress={() => onToggle(cat)}
                  testID={`onboarding-categories.row.${cat}`}
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
                testID="onboarding-categories.show-more"
                style={styles.showMore}
              >
                <Text style={styles.showMoreText}>
                  Show more ({PROMPT_CATEGORIES.length - DEFAULT_VISIBLE_CATEGORIES.length})
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void onContinue()}
          style={[styles.cta, busy && styles.ctaDisabled]}
          testID="onboarding-categories.continue"
        >
          {busy ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.ctaText}>{dirty ? 'Save & continue' : 'Skip'}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, gap: 16, paddingBottom: 24 },
  step: { color: '#5a5a5a', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '700', lineHeight: 34 },
  body: { color: '#9e9e9e', fontSize: 15, lineHeight: 22, marginTop: 4 },
  loader: { marginTop: 32 },
  list: { marginTop: 8, gap: 8 },
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
  showMore: { paddingVertical: 14, alignItems: 'center' },
  showMoreText: { color: '#9ec5ff', fontSize: 15, fontWeight: '600' },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e1e1e',
  },
  cta: {
    backgroundColor: '#9ec5ff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#2a2a2a' },
  ctaText: { color: '#0a0a0a', fontSize: 17, fontWeight: '700' },
});
