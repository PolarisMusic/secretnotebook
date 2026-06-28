import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { type PromptCategory } from '../../features/secret-unlock/categories';
import {
  getPromptCategories,
  setMyPromptCategories,
} from '../../features/secret-unlock/preferences-store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { PromptPreferences } from './PromptPreferences';

type Nav = NativeStackNavigationProp<MainStackParamList>;

/**
 * Production wiring for the Prompt Preferences screen. Loads the local
 * user's current category set on focus, lets the user toggle locally,
 * and writes + broadcasts on Save. Save is a no-op until the user has
 * actually changed something (`dirty`) so a tap on a fully-untouched
 * screen doesn't generate an op.
 */
export function PromptPreferencesRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [enabled, setEnabled] = useState<Set<PromptCategory> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!exec || !engine) {
        setEnabled(new Set());
        setDirty(false);
        return;
      }
      void getPromptCategories(exec, engine.selfPub).then((set) => {
        if (cancelled) return;
        setEnabled(set);
        setDirty(false);
      });
      return () => {
        cancelled = true;
      };
    }, [exec, engine]),
  );

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

  const onSave = useCallback(() => {
    if (!exec || !engine || !enabled || !dirty || isSaving) return;
    setIsSaving(true);
    void (async () => {
      try {
        await setMyPromptCategories(
          {
            exec,
            selfPubkey: engine.selfPub,
            enqueue: (op) => engine.enqueue(op),
          },
          [...enabled],
        );
        setDirty(false);
        navigation.goBack();
      } catch (e) {
        Alert.alert('Could not save preferences', (e as Error).message);
      } finally {
        setIsSaving(false);
      }
    })();
  }, [exec, engine, enabled, dirty, isSaving, navigation]);

  return (
    <PromptPreferences
      enabled={enabled ?? new Set<PromptCategory>()}
      isSaving={isSaving}
      dirty={dirty}
      onToggle={onToggle}
      onSave={onSave}
      onBack={() => navigation.goBack()}
    />
  );
}
