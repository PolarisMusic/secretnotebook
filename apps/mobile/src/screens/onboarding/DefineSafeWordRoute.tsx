import { useDatabaseStore } from '../../db/store';
import { deriveCoupleSafeWord, saveSafeWord } from '../../features/safeword/verifier';
import { useSafeWordSession } from '../../features/safeword/session';
import { useCoupleStore } from '../../state/couple';
import { DefineSafeWord } from './DefineSafeWord';

/**
 * Production wiring for DefineSafeWord. Reads the pending root_key and
 * coupleId from the couple store (set by the pairing flow), derives the
 * Argon2id material, writes the row via the database store's executor,
 * advances couple.status to 'paired', and satisfies the Safe Word
 * session so the user is not immediately prompted by the gate.
 */
export function DefineSafeWordRoute(): JSX.Element {
  const exec = useDatabaseStore((s) => s.exec);
  const coupleId = useCoupleStore((s) => s.coupleId);
  const pendingRootKey = useCoupleStore((s) => s.pendingRootKey);
  const finalizePairing = useCoupleStore((s) => s.finalizePairing);
  const satisfySession = useSafeWordSession((s) => s.satisfy);

  return (
    <DefineSafeWord
      onSubmit={async (safeword) => {
        if (!exec) return 'Database is not ready yet — try again in a moment.';
        if (!coupleId || !pendingRootKey) {
          return 'Pairing state is missing — restart from the beginning.';
        }
        try {
          const material = await deriveCoupleSafeWord(pendingRootKey, safeword);
          await saveSafeWord(exec, coupleId, material);
          finalizePairing();
          satisfySession();
          return null;
        } catch (e) {
          return (e as Error).message ?? 'Could not save Safe Word';
        }
      }}
    />
  );
}
