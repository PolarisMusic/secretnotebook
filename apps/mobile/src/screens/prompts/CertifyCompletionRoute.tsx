import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import { findPromptById, type PromptRow } from '../../features/prompts/store';
import { certifyPromptCompletion } from '../../features/prompts/transitions';
import type { MainStackParamList } from '../../navigation/MainStack';
import { CertifyCompletion } from './CertifyCompletion';

/**
 * Production wiring for CertifyCompletion. Mirrors ActivePromptRoute
 * but on the non-assignee's side: fires certifyPromptCompletion +
 * engine.flush() so the certified state propagates to the partner
 * quickly.
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
