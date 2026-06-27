import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { bytesToHex } from '@secretnotebook/crypto';

import { useDatabaseStore } from '../../db/store';
import { listNoteAttachments } from '../../features/attachments/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { getNote } from '../../features/notes/store';
import { drawRandomPromptTexts, resolvePromptText } from '../../features/secret-unlock/prompts';
import {
  cancelUnlock,
  discloseRevealedNoteToAuthor,
  getReflectionBy,
  getUnlock,
  isReflectionComplete,
  reflectOnUnlock,
  rejectUnlock,
  submitUnlock,
  verifyUnlock,
  type SecretUnlockStoreDeps,
  type UnlockReflectionRow,
  type UnlockState,
} from '../../features/secret-unlock/store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { SecretUnlockDetail, type ReflectionView } from './SecretUnlockDetail';

type Nav = NativeStackNavigationProp<MainStackParamList>;
type Rt = RouteProp<MainStackParamList, 'SecretUnlockDetail'>;

interface ViewModel {
  role: 'author' | 'unlocker';
  state: UnlockState;
  promptText: string;
  /** False for the Author until the Unlocker has at least once submitted. */
  showPrompt: boolean;
  revealedBody: string | null;
  revealedHasMedia: boolean;
  showSecret: boolean;
  authorMustDisclose: boolean;
  myReflection: ReflectionView | null;
  partnerReflection: ReflectionView | null;
  complete: boolean;
}

function reflectionView(r: UnlockReflectionRow | null): ReflectionView | null {
  return r ? { appreciate: r.appreciate, uncomfortable: r.uncomfortable } : null;
}

/**
 * Production wiring for a single unlock attempt. Re-derives the full
 * view-model on focus (and after every action) so a synced state change
 * from the partner shows up, and threads the unlock store's actions back
 * to the buttons with a shared busy guard.
 */
export function SecretUnlockDetailRoute(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const attemptId = params.id;
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [vm, setVm] = useState<ViewModel | null>(null);
  const [busy, setBusy] = useState(false);

  // Random snapshots to flash through the prompt card on first arrival from
  // "Start an unlock" (params.intro). Pre-drawn once so a re-render mid-
  // shuffle doesn't shake the texts; the component animates through them
  // exactly once on mount.
  const shuffleTexts = useMemo<readonly string[] | null>(
    () => (params.intro ? drawRandomPromptTexts(9) : null),
    [params.intro],
  );

  const deps: SecretUnlockStoreDeps | null =
    exec && engine
      ? {
          exec,
          selfPubkey: engine.selfPub,
          peerPubkey: engine.peerPub,
          enqueue: (op) => engine.enqueue(op),
        }
      : null;

  const refresh = useCallback(async () => {
    if (!exec || !engine) return;
    try {
      await engine.pull();
    } catch {
      // best-effort
    }
    const attempt = await getUnlock(exec, attemptId);
    if (!attempt) {
      setVm(null);
      return;
    }
    const selfHex = bytesToHex(engine.selfPub);
    const role: 'author' | 'unlocker' =
      bytesToHex(attempt.authorPubkey) === selfHex ? 'author' : 'unlocker';

    let revealedBody: string | null = null;
    let revealedHasMedia = false;
    let authorMustDisclose = false;
    let showSecret = false;
    if (attempt.state === 'revealed' && attempt.revealedNoteId) {
      const note = await getNote(exec, attempt.revealedNoteId);
      revealedHasMedia = (await listNoteAttachments(exec, attempt.revealedNoteId)).length > 0;
      if (role === 'author') {
        // Blind until the Author discloses: revealed_at is set only then.
        authorMustDisclose = note?.revealedAt == null;
        showSecret = !authorMustDisclose;
      } else {
        showSecret = true;
      }
      revealedBody = note?.body ?? null;
    }

    const [myR, partnerR, complete] =
      attempt.state === 'revealed'
        ? await Promise.all([
            getReflectionBy(exec, attemptId, engine.selfPub),
            getReflectionBy(exec, attemptId, engine.peerPub),
            isReflectionComplete(exec, attemptId),
          ])
        : [null, null, false];

    // Author stays blind to the drawn prompt until the Unlocker has at
    // least once submitted ("asks for verification"). `submittedAt` latches:
    // once set it never unsets, so a later send-back / cancel keeps the
    // prompt visible to the Author who has already seen it.
    const showPrompt = role === 'unlocker' || attempt.submittedAt != null;

    setVm({
      role,
      state: attempt.state,
      promptText: resolvePromptText(attempt.promptKey),
      showPrompt,
      revealedBody,
      revealedHasMedia,
      showSecret,
      authorMustDisclose,
      myReflection: reflectionView(myR),
      partnerReflection: reflectionView(partnerR),
      complete,
    });
  }, [exec, engine, attemptId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const run = useCallback(
    async (fn: (d: SecretUnlockStoreDeps) => Promise<unknown>, failTitle: string) => {
      if (!deps || busy) return;
      setBusy(true);
      try {
        await fn(deps);
        await refresh();
      } catch (e) {
        Alert.alert(failTitle, (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [deps, busy, refresh],
  );

  return (
    <SecretUnlockDetail
      loading={vm == null}
      role={vm?.role ?? 'unlocker'}
      state={vm?.state ?? 'assigned'}
      promptText={vm?.promptText ?? ''}
      showPrompt={vm?.showPrompt ?? false}
      shuffleTexts={shuffleTexts}
      revealedBody={vm?.revealedBody ?? null}
      revealedHasMedia={vm?.revealedHasMedia ?? false}
      showSecret={vm?.showSecret ?? false}
      authorMustDisclose={vm?.authorMustDisclose ?? false}
      myReflection={vm?.myReflection ?? null}
      partnerReflection={vm?.partnerReflection ?? null}
      complete={vm?.complete ?? false}
      busy={busy}
      onBack={() => navigation.goBack()}
      onSubmit={() => void run((d) => submitUnlock(d, attemptId), 'Could not submit')}
      onCancel={() => void run((d) => cancelUnlock(d, attemptId), 'Could not cancel')}
      onVerify={() => void run((d) => verifyUnlock(d, attemptId), 'Could not verify')}
      onReject={() => void run((d) => rejectUnlock(d, attemptId), 'Could not send back')}
      onDisclose={() =>
        void run((d) => discloseRevealedNoteToAuthor(d, attemptId), 'Could not reveal')
      }
      onReflect={(appreciate, uncomfortable) =>
        void run(
          (d) => reflectOnUnlock(d, attemptId, { appreciate, uncomfortable }),
          'Could not save reflection',
        )
      }
    />
  );
}
