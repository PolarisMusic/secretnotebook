import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { bytesToHex } from '@secretnotebook/crypto';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { getMyRole } from '../../features/connection/role-store';
import { sumConnectionPoints } from '../../features/ledger/store';
import {
  countUnrevealedSecretsBy,
  getReflectionBy,
  isReflectionComplete,
  listUnlocksFor,
  startUnlock,
  type SecretUnlockRow,
  type UnlockState,
} from '../../features/secret-unlock/store';
import { resolvePromptText } from '../../features/secret-unlock/prompts';
import { getPointsVisible } from '../../features/settings/points-visibility';
import { useConnectionStore } from '../../state/connection';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SecretUnlockList, type UnlockListItem } from './SecretUnlockList';

type Nav = NativeStackNavigationProp<MainStackParamList>;

const ACTIVE: readonly UnlockState[] = ['assigned', 'submitted', 'returned'];

interface ViewModel {
  couplePoints: number;
  showPoints: boolean;
  items: UnlockListItem[];
  canStart: boolean;
  startDisabledReason: string | null;
}

function statusFor(
  state: UnlockState,
  role: 'author' | 'unlocker',
  complete: boolean,
  iReflected: boolean,
): { statusLine: string; needsYou: boolean } {
  if (state === 'canceled') return { statusLine: 'Canceled', needsYou: false };
  if (state === 'revealed') {
    if (complete) return { statusLine: 'Complete', needsYou: false };
    if (!iReflected) return { statusLine: 'Reflect on the secret', needsYou: true };
    return { statusLine: "Waiting for partner's reflection", needsYou: false };
  }
  if (role === 'unlocker') {
    if (state === 'assigned') return { statusLine: 'Your task is waiting', needsYou: true };
    if (state === 'returned') return { statusLine: 'Sent back — try again', needsYou: true };
    return { statusLine: 'Waiting for verification', needsYou: false }; // submitted
  }
  // author
  if (state === 'submitted') return { statusLine: "Verify your partner's task", needsYou: true };
  if (state === 'returned') return { statusLine: 'Sent back to partner', needsYou: false };
  return { statusLine: "Waiting for partner's task", needsYou: false }; // assigned
}

/**
 * Production wiring for the unlock hub. Loads the couple's point total and
 * every attempt this device is part of, derives a per-row status + whose
 * move it is, and gates "Start an unlock" on pairing + a non-empty partner
 * pool + no in-flight attempt of our own.
 */
export function SecretUnlockListRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const status = useConnectionStore((s) => s.status);
  const [vm, setVm] = useState<ViewModel | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!exec || !engine) {
      setVm({
        couplePoints: 0,
        showPoints: false,
        items: [],
        canStart: false,
        startDisabledReason: 'Pair with your partner first.',
      });
      return;
    }
    setIsRefreshing(true);
    try {
      try {
        await engine.pull();
      } catch {
        // best-effort; the read below still reflects local state
      }
      const selfHex = bytesToHex(engine.selfPub);
      const [points, rows, pool] = await Promise.all([
        sumConnectionPoints(exec),
        listUnlocksFor(exec, engine.selfPub),
        countUnrevealedSecretsBy(exec, engine.peerPub),
      ]);

      const items: UnlockListItem[] = [];
      let hasActiveAsUnlocker = false;
      for (const r of rows) {
        const role: 'author' | 'unlocker' =
          bytesToHex(r.authorPubkey) === selfHex ? 'author' : 'unlocker';
        if (role === 'unlocker' && ACTIVE.includes(r.state)) hasActiveAsUnlocker = true;
        const complete = r.state === 'revealed' ? await isReflectionComplete(exec, r.id) : false;
        const iReflected =
          r.state === 'revealed'
            ? (await getReflectionBy(exec, r.id, engine.selfPub)) != null
            : false;
        const { statusLine, needsYou } = statusFor(r.state, role, complete, iReflected);
        items.push({
          id: r.id,
          promptText: resolvePromptText(r.promptKey),
          statusLine,
          needsYou,
          createdAt: r.createdAt,
        });
      }
      // Whose-move-it-is floats to the top; ties keep newest-first.
      items.sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || b.createdAt - a.createdAt);

      const paired = status === 'paired';
      let reason: string | null = null;
      if (!paired) reason = 'Pair with your partner first.';
      else if (pool < 1) reason = 'Your partner has no secret notes yet.';
      else if (hasActiveAsUnlocker) reason = 'Finish your current unlock first.';
      const myRole = await getMyRole(exec, engine.selfPub);
      const showPoints = await getPointsVisible(exec, myRole);
      setVm({
        couplePoints: points,
        showPoints,
        items,
        canStart: reason == null,
        startDisabledReason: reason,
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine, status]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onStart = useCallback(async () => {
    if (!exec || !engine) return;
    try {
      const attempt: SecretUnlockRow = await startUnlock({
        exec,
        selfPubkey: engine.selfPub,
        peerPubkey: engine.peerPub,
        enqueue: (op) => engine.enqueue(op),
      });
      // intro=true tells the detail screen to play the shuffle animation
      // once before settling on the drawn prompt.
      navigation.navigate('SecretUnlockDetail', { id: attempt.id, intro: true });
    } catch (e) {
      Alert.alert('Could not start', (e as Error).message);
    }
  }, [exec, engine, navigation]);

  return (
    <SecretUnlockList
      couplePoints={vm?.couplePoints ?? 0}
      showPoints={vm?.showPoints ?? false}
      items={vm?.items ?? []}
      isLoading={vm == null}
      isRefreshing={isRefreshing}
      paired={status === 'paired'}
      canStart={vm?.canStart ?? false}
      startDisabledReason={vm?.startDisabledReason ?? null}
      onRefresh={() => void refresh()}
      onStart={() => void onStart()}
      onSelect={(id) => navigation.navigate('SecretUnlockDetail', { id })}
      onPreferences={() => navigation.navigate('PromptPreferences')}
    />
  );
}
