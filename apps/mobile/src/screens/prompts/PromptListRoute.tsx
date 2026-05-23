import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/couple-channel/store';
import { assignPromptForPartner } from '../../features/prompts/assigner';
import {
  listAwaitingMyCertification,
  listMyActivePrompts,
  type PromptRow,
} from '../../features/prompts/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { PromptList, type PromptListSection } from './PromptList';

function rowToItem(r: PromptRow): {
  promptId: string;
  libraryKey: string;
  title: string;
  body: string;
  createdAtHint?: number;
} {
  return {
    promptId: r.id,
    libraryKey: r.libraryKey,
    title: r.title,
    body: r.body,
    createdAtHint: r.completedAt ?? undefined,
  };
}

/**
 * Production wiring for PromptList. Two sections: prompts assigned to
 * me (open the "I did it" detail), and prompts my partner just
 * completed and is waiting for me to certify (open the certification
 * detail). The header "Assign" button picks a fresh prompt for the
 * partner via the weighted-random library picker.
 *
 * Pull-to-refresh kicks the sync engine's pull() so newly-completed
 * partner prompts surface without waiting for the foreground ticker.
 */
export function PromptListRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [active, setActive] = useState<PromptRow[] | null>(null);
  const [awaitingCert, setAwaitingCert] = useState<PromptRow[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setActive([]);
      setAwaitingCert([]);
      return;
    }
    setIsRefreshing(true);
    try {
      try {
        await engine.pull();
      } catch {
        // best-effort — UI still renders local state below
      }
      const [a, b] = await Promise.all([
        listMyActivePrompts(exec, engine.selfPub),
        listAwaitingMyCertification(exec, engine.selfPub),
      ]);
      setActive(a);
      setAwaitingCert(b);
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isLoading = active == null || awaitingCert == null;
  const sections: PromptListSection[] = [
    {
      key: 'assigned-to-me',
      title: 'Assigned to you',
      emptyHint: 'Nothing on your plate. Tap Assign to give your partner one.',
      data: (active ?? []).map(rowToItem),
    },
    {
      key: 'awaiting-my-cert',
      title: 'Awaiting your confirmation',
      emptyHint: 'Nothing to confirm right now.',
      data: (awaitingCert ?? []).map(rowToItem),
    },
  ];

  const onAssign = async (): Promise<void> => {
    if (!exec || !engine) return;
    setAssignError(null);
    setIsAssigning(true);
    try {
      await assignPromptForPartner({
        exec,
        engine,
        assignedToPubkey: engine.peerPub,
        assignedByPubkey: engine.selfPub,
      });
      // Best-effort push so the partner sees it soon.
      void engine.flush().catch(() => undefined);
      await refresh();
    } catch (e) {
      setAssignError((e as Error).message ?? 'Could not assign prompt');
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <PromptList
      sections={sections}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      isAssigning={isAssigning}
      assignError={assignError}
      onRefresh={() => void refresh()}
      onBack={() => navigation.goBack()}
      onAssign={onAssign}
      onSelect={(section, item) => {
        if (section === 'assigned-to-me') {
          navigation.navigate('ActivePrompt', { id: item.promptId });
        } else {
          navigation.navigate('CertifyCompletion', { id: item.promptId });
        }
      }}
    />
  );
}
