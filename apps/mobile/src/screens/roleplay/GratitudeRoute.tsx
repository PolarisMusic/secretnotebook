import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { bytesToHex } from '@secretnotebook/crypto';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import { countLedgerEntriesFor } from '../../features/ledger/store';
import { LEDGER_REASON } from '../../features/ledger/couple-points';
import { markGratitudeStep } from '../../features/roleplay/actions';
import { findRoleplaySession, type RoleplaySessionRow } from '../../features/roleplay/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { Gratitude } from './Gratitude';

/**
 * Production wiring for Gratitude. Each side marks done on its own
 * device; when both done land on the same device (whether locally
 * or via a pull), the +25 lands via the sweeper (foreground ticker)
 * or via markGratitudeStep's own check.
 */
export function GratitudeRoute(): JSX.Element {
  const route = useRoute<RouteProp<MainStackParamList, 'Gratitude'>>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [row, setRow] = useState<RoleplaySessionRow | null>(null);
  const [loopAwarded, setLoopAwarded] = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!exec) return;
    const r = await findRoleplaySession(exec, route.params.sessionId);
    setRow(r);
    if (r) {
      setLoopAwarded((await countLedgerEntriesFor(exec, LEDGER_REASON.loopCompleted, r.id)) > 0);
    }
  }, [exec, route.params.sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mySide: 'enactor' | 'curator' | null =
    row && engine
      ? bytesToHex(row.enactorPubkey) === bytesToHex(engine.selfPub)
        ? 'enactor'
        : 'curator'
      : null;
  const mineDone =
    row != null &&
    mySide != null &&
    (mySide === 'enactor'
      ? row.gratitudeEnactorDoneAt != null
      : row.gratitudeCuratorDoneAt != null);
  const partnerDone =
    row != null &&
    mySide != null &&
    (mySide === 'enactor'
      ? row.gratitudeCuratorDoneAt != null
      : row.gratitudeEnactorDoneAt != null);

  const onMarkDone = async (): Promise<void> => {
    if (!exec || !engine || !row || !mySide) return;
    setError(null);
    setIsMarking(true);
    try {
      const result = await markGratitudeStep({
        exec,
        engine,
        sessionId: row.id,
        side: mySide,
        actorPubkey: engine.selfPub,
      });
      void engine.flush().catch(() => undefined);
      if (result.loopAwarded) setLoopAwarded(true);
      await load();
    } catch (e) {
      setError((e as Error).message ?? 'Could not mark gratitude done');
    } finally {
      setIsMarking(false);
    }
  };

  return (
    <Gratitude
      title={row?.gratitudePromptTitle ?? 'Gratitude'}
      body={row?.gratitudePromptBody ?? ''}
      mineDone={mineDone}
      partnerDone={partnerDone}
      loopAwarded={loopAwarded}
      isMarking={isMarking}
      error={error}
      onBack={() => navigation.goBack()}
      onMarkDone={onMarkDone}
    />
  );
}
