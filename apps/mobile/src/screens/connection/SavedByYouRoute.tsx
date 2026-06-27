import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { ActionSheet, type ActionSheetAction } from '../../components/ActionSheet';
import { useDatabaseStore } from '../../db/store';
import { getCachedPost } from '../../features/api/cache';
import {
  listSavedByMe,
  removeSavedPost,
  type SavedPostRow,
} from '../../features/connection-channel/saved-post-store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { writeSecretNote, writeSharedNote, type NoteStoreDeps } from '../../features/notes/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SavedByYou, type SavedByYouItem } from './SavedByYou';

/**
 * Production wiring for the Saved tab. Reads saved_post rows the local
 * device owns, joins them against the local post_cache for body previews,
 * and exposes an action sheet on tap: open the original post, promote it
 * into a shared/secret note, or drop the bookmark.
 *
 * The promote flow ends up calling writeShared/SecretNote with the cached
 * body — same write path the regular composer uses, so the partner sees
 * the new note via the usual `note.share.add` / `note.secret.announce`
 * cycle. The saved_post row stays put unless the user picks Remove
 * (manual triage > auto-cleanup; see the product notes in #10).
 */
export function SavedByYouRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [items, setItems] = useState<SavedByYouItem[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selected, setSelected] = useState<SavedByYouItem | null>(null);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setItems([]);
      return;
    }
    setIsRefreshing(true);
    try {
      const rows: SavedPostRow[] = await listSavedByMe(exec, engine.selfPub);
      // Pull the body from the local cache so the list shows substance, not
      // just an id. A saved post whose cache hasn't been populated yet shows
      // a "body not on this device" placeholder.
      const next: SavedByYouItem[] = await Promise.all(
        rows.map(async (r) => {
          const cached = await getCachedPost(exec, r.globalPostId);
          return {
            savedPostId: r.id,
            globalPostId: r.globalPostId,
            createdAt: r.createdAt,
            bodyPreview: cached?.body ?? null,
          };
        }),
      );
      setItems(next);
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const promoteToNote = useCallback(
    async (kind: 'shared' | 'secret', body: string): Promise<void> => {
      if (!exec || !engine) return;
      const deps: NoteStoreDeps = {
        exec,
        selfPubkey: engine.selfPub,
        enqueue: (op) => engine.enqueue(op),
      };
      try {
        if (kind === 'secret') await writeSecretNote(deps, body);
        else await writeSharedNote(deps, body);
        Alert.alert(
          'Added to notes',
          kind === 'secret'
            ? 'A new secret note holds this post’s text.'
            : 'A new shared note holds this post’s text.',
        );
      } catch (e) {
        Alert.alert('Could not add to notes', (e as Error).message);
      }
    },
    [exec, engine],
  );

  const close = useCallback(() => setSelected(null), []);

  const actions = useMemo<ReadonlyArray<ActionSheetAction>>(() => {
    if (!selected) return [];
    const body = selected.bodyPreview?.trim() ?? '';
    const canPromote = body.length > 0;
    const acts: ActionSheetAction[] = [
      {
        label: 'Open',
        testID: 'saved-by-you.action.open',
        onPress: () => {
          close();
          navigation.navigate('PostDetail', { id: selected.globalPostId });
        },
      },
    ];
    if (canPromote && engine) {
      acts.push({
        label: 'Add to shared notes',
        testID: 'saved-by-you.action.share',
        onPress: () => {
          close();
          void promoteToNote('shared', body);
        },
      });
      acts.push({
        label: 'Add to secret notes',
        testID: 'saved-by-you.action.secret',
        onPress: () => {
          close();
          void promoteToNote('secret', body);
        },
      });
    }
    acts.push({
      label: 'Remove from saved',
      style: 'destructive',
      testID: 'saved-by-you.action.remove',
      onPress: () => {
        close();
        if (!exec) return;
        void (async () => {
          try {
            await removeSavedPost(exec, selected.savedPostId);
            await refresh();
          } catch (e) {
            Alert.alert('Could not remove', (e as Error).message);
          }
        })();
      },
    });
    return acts;
  }, [selected, engine, exec, navigation, promoteToNote, refresh, close]);

  const messageBody = selected?.bodyPreview?.trim().slice(0, 200) ?? '';

  return (
    <>
      <SavedByYou
        items={items ?? []}
        isLoading={items == null}
        isRefreshing={isRefreshing}
        onRefresh={() => void refresh()}
        onBack={() => navigation.goBack()}
        onSelect={setSelected}
      />
      <ActionSheet
        visible={selected != null}
        title="Saved post"
        message={messageBody.length > 0 ? messageBody : undefined}
        actions={actions}
        onCancel={close}
        testID="saved-by-you.sheet"
      />
    </>
  );
}
