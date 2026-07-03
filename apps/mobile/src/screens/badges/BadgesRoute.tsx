import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { sumConnectionPoints } from '../../features/ledger/store';
import { BadgesScreen } from './BadgesScreen';

/**
 * Production wiring for the badges gallery. Re-reads the couple's Sparks
 * total on focus so a badge earned since last visit shows immediately.
 */
export function BadgesRoute(): JSX.Element {
  const exec = useDatabaseStore((s) => s.exec);
  const [points, setPoints] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!exec) return;
      let cancelled = false;
      void sumConnectionPoints(exec).then((p) => {
        if (!cancelled) setPoints(p);
      });
      return () => {
        cancelled = true;
      };
    }, [exec]),
  );

  return <BadgesScreen totalPoints={points} />;
}
