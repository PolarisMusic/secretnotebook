import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GRATITUDE_LIBRARY, pickPromptWeighted } from '@secretnotebook/prompt-library';
import { bytesToHex } from '@secretnotebook/crypto';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { cachePost, getCachedPost } from '../../features/api/cache';
import { useApiStore } from '../../features/api/store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import { findRoleplayBySavedPostId, type RoleplaySessionRow } from '../../features/roleplay/store';
import { startRoleplay } from '../../features/roleplay/actions';
import type { MainStackParamList } from '../../navigation/MainStack';
import { UnlockedPostDetail } from './UnlockedPostDetail';

/**
 * Production wiring for UnlockedPostDetail. Resolves the saved_post +
 * the global post body, surfaces the "I tried it" CTA (enactor-side
 * entry point for S8). Once tapped, picks a fresh gratitude prompt
 * via the weighted-random library, calls startRoleplay, navigates
 * the user into the rating/gratitude flow.
 */
export function UnlockedPostDetailRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'UnlockedPostDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const apiClient = useApiStore((s) => s.client);
  const engine = useSyncEngineStore((s) => s.engine);

  const [body, setBody] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedPostRow, setSavedPostRow] = useState<{
    unlockedAt: number | null;
    savedByPubkey: Uint8Array;
    savedForPubkey: Uint8Array;
  } | null>(null);
  const [existingSession, setExistingSession] = useState<RoleplaySessionRow | null>(null);

  const load = useCallback(async () => {
    if (!exec) return;
    setIsLoading(true);
    try {
      const rows = await exec.query<{
        global_post_id: string;
        unlocked_at: number | null;
        saved_by_pubkey: Uint8Array;
        saved_for_pubkey: Uint8Array;
      }>(
        `SELECT global_post_id, unlocked_at, saved_by_pubkey, saved_for_pubkey
           FROM saved_post WHERE id = ?`,
        [route.params.savedPostId],
      );
      const r = rows[0];
      if (!r) {
        setError('Saved post not found');
        return;
      }
      setSavedPostRow({
        unlockedAt: r.unlocked_at,
        savedByPubkey:
          r.saved_by_pubkey instanceof Uint8Array
            ? r.saved_by_pubkey
            : new Uint8Array(r.saved_by_pubkey as ArrayBufferLike),
        savedForPubkey:
          r.saved_for_pubkey instanceof Uint8Array
            ? r.saved_for_pubkey
            : new Uint8Array(r.saved_for_pubkey as ArrayBufferLike),
      });
      const cached = await getCachedPost(exec, r.global_post_id);
      if (cached) {
        setBody(cached.body);
      } else if (apiClient) {
        try {
          const post = await apiClient.getPost(r.global_post_id);
          await cachePost(exec, post);
          setBody(post.body);
        } catch (e) {
          setError((e as Error).message ?? 'Could not load the post');
        }
      }
      setExistingSession(await findRoleplayBySavedPostId(exec, route.params.savedPostId));
    } finally {
      setIsLoading(false);
    }
  }, [exec, apiClient, route.params.savedPostId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onTriedIt = async (): Promise<void> => {
    if (!exec || !engine || !savedPostRow) return;
    try {
      // Gratitude prompt picked at start time so both partners see the
      // same words. The library is small (~10) so no exclusion list is
      // needed yet; future scope can mirror the assigner's
      // repeat-avoidance.
      const picked = pickPromptWeighted(GRATITUDE_LIBRARY);
      const { sessionId } = await startRoleplay({
        exec,
        engine,
        enactorPubkey: engine.selfPub,
        // The "saver" — the other side relative to me — is the curator.
        // Pull it from the row; for an unlocked-for-me post that's
        // saved_by_pubkey.
        curatorPubkey: savedPostRow.savedByPubkey,
        savedPostId: route.params.savedPostId,
        gratitudePromptKey: picked.prompt.key,
        gratitudePromptTitle: picked.prompt.title,
        gratitudePromptBody: picked.prompt.body,
      });
      void engine.flush().catch(() => undefined);
      navigation.navigate('Gratitude', { sessionId });
    } catch (e) {
      setError((e as Error).message ?? 'Could not start the loop');
    }
  };

  return (
    <UnlockedPostDetail
      body={body}
      isLoading={isLoading}
      error={error}
      unlockedAt={savedPostRow?.unlockedAt ?? null}
      alreadyStarted={existingSession != null}
      onBack={() => navigation.goBack()}
      onTriedIt={onTriedIt}
      onContinueLoop={
        existingSession
          ? () => {
              // Curator gets routed to rating if not yet rated AND
              // they're the curator; everyone else lands on gratitude.
              if (
                engine &&
                existingSession.rating == null &&
                bytesToHex(existingSession.curatorPubkey) === bytesToHex(engine.selfPub)
              ) {
                navigation.navigate('RatingFlow', { sessionId: existingSession.id });
              } else {
                navigation.navigate('Gratitude', { sessionId: existingSession.id });
              }
            }
          : undefined
      }
    />
  );
}
