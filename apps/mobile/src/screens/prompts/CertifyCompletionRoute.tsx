import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import {
  awardCouplePoints,
  LEDGER_REASON,
  POINTS_PROMPT_CERTIFIED,
} from '../../features/ledger/couple-points';
import { findPromptById, type PromptRow } from '../../features/prompts/store';
import { certifyPromptCompletion } from '../../features/prompts/transitions';
import { unlockOneRandomFor } from '../../features/saved-posts/random-unlocker';
import type { MainStackParamList } from '../../navigation/MainStack';
import { CertifyCompletion } from './CertifyCompletion';

/**
 * Production wiring for CertifyCompletion. Mirrors ActivePromptRoute
 * but on the non-assignee's side: fires certifyPromptCompletion AND
 * (per S7) immediately calls unlockOneRandomFor to pick one of the
 * assignee's locked saved_posts and link it to this prompt. The
 * partner mirrors both ops on next pull, so their SavedForYou tile
 * flips Locked → Unlocked within the foreground ticker window.
 *
 * Per spec edge: when the assignee has no locked posts, the prompt
 * still certifies but no unlock fires (unlockOneRandomFor returns
 * null). A future S8 ledger entry will still credit Couple Points;
 * for now the UI just lands on the "certified" state line.
 */
export function CertifyCompletionRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'CertifyCompletion'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [row, setRow] = useState<PromptRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCertifying, setIsCertifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!exec) return;
    setIsLoading(true);
    try {
      setRow(await findPromptById(exec, route.params.id));
    } finally {
      setIsLoading(false);
    }
  }, [exec, route.params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const alreadyCertified = row?.state === 'certified';

  const onCertify = async (): Promise<void> => {
    if (!exec || !engine || !row) return;
    setError(null);
    setIsCertifying(true);
    try {
      await certifyPromptCompletion({
        exec,
        engine,
        promptId: row.id,
        actorPubkey: engine.selfPub,
      });
      // S7: pick one of the assignee's locked saved_posts and unlock
      // it for them. row.assignedToPubkey is the assignee from the
      // freshly-loaded prompt row. Failures here are non-fatal — the
      // certification has already succeeded; the unlock can be
      // retried by a future pass (the projector + presence guard
      // make a re-run idempotent).
      try {
        await unlockOneRandomFor({
          exec,
          engine,
          assigneePubkey: row.assignedToPubkey,
          unlockPromptId: row.id,
        });
      } catch {
        // best effort — the certify state is what counts for the UX
      }
      // S8 accrual: +10 Couple Points per certification. Deterministic
      // ledger row id keyed on (reason, promptId) so a re-tap or a
      // partner-side retry merges into a single entry.
      try {
        await awardCouplePoints({
          exec,
          engine,
          delta: POINTS_PROMPT_CERTIFIED,
          reason: LEDGER_REASON.promptCertified,
          refId: row.id,
        });
      } catch {
        // best effort — same logic as the unlock above
      }
      void engine.flush().catch(() => undefined);
      await load();
    } catch (e) {
      setError((e as Error).message ?? 'Could not certify');
    } finally {
      setIsCertifying(false);
    }
  };

  return (
    <CertifyCompletion
      title={row?.title ?? null}
      body={row?.body ?? null}
      isLoading={isLoading}
      isCertifying={isCertifying}
      error={error}
      alreadyCertified={alreadyCertified}
      onCertify={onCertify}
      onBack={() => navigation.goBack()}
    />
  );
}
