import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import { findPromptById, type PromptRow } from '../../features/prompts/store';
import { markPromptCompleted } from '../../features/prompts/transitions';
import type { MainStackParamList } from '../../navigation/MainStack';
import { ActivePrompt } from './ActivePrompt';

/**
 * Production wiring for ActivePrompt. Loads the row by id, renders
 * title + body, exposes "I did it" which fires markPromptCompleted +
 * kicks engine.flush() so the partner can certify quickly.
 */
export function ActivePromptRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'ActivePrompt'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [row, setRow] = useState<PromptRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMarking, setIsMarking] = useState(false);
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

  const alreadyDone = row != null && row.state !== 'assigned';

  const onMarkDone = async (): Promise<void> => {
    if (!exec || !engine || !row) return;
    setError(null);
    setIsMarking(true);
    try {
      await markPromptCompleted({
        exec,
        engine,
        promptId: row.id,
        actorPubkey: engine.selfPub,
      });
      void engine.flush().catch(() => undefined);
      await load();
    } catch (e) {
      setError((e as Error).message ?? 'Could not mark done');
    } finally {
      setIsMarking(false);
    }
  };

  return (
    <ActivePrompt
      title={row?.title ?? null}
      body={row?.body ?? null}
      isLoading={isLoading}
      isMarkingDone={isMarking}
      error={error}
      alreadyDone={alreadyDone}
      onMarkDone={onMarkDone}
      onBack={() => navigation.goBack()}
    />
  );
}
