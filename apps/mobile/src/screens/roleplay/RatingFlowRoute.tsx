import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import { setRoleplayRating } from '../../features/roleplay/actions';
import { findRoleplaySession, type RoleplaySessionRow } from '../../features/roleplay/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { RatingFlow } from './RatingFlow';

/**
 * Production wiring for RatingFlow. Loads the session, lets the
 * curator submit a 1..10 rating, navigates them to the gratitude
 * screen after submit. The projector's actor + null guards make
 * misfires (wrong actor / re-submit) no-ops, but we also defensively
 * pre-check via `existingRating` so the curator's button stays read-
 * only on a refresh.
 */
export function RatingFlowRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'RatingFlow'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [row, setRow] = useState<RoleplaySessionRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!exec) return;
    setRow(await findRoleplaySession(exec, route.params.sessionId));
  }, [exec, route.params.sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (rating: number): Promise<void> => {
    if (!exec || !engine || !row) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await setRoleplayRating({
        exec,
        engine,
        sessionId: row.id,
        actorPubkey: engine.selfPub,
        rating,
      });
      void engine.flush().catch(() => undefined);
      navigation.replace('Gratitude', { sessionId: row.id });
    } catch (e) {
      setError((e as Error).message ?? 'Could not submit rating');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RatingFlow
      isSubmitting={isSubmitting}
      error={error}
      existingRating={row?.rating ?? null}
      onBack={() => navigation.goBack()}
      onSubmit={onSubmit}
    />
  );
}
