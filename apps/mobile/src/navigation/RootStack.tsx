import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useBackgroundLock } from '../features/safeword/background-lock';
import { isSafeWordSatisfied, useSafeWordSession } from '../features/safeword/session';
import { SafeWordGateRoute } from '../screens/auth/SafeWordGateRoute';
import { useCoupleStore } from '../state/couple';
import { MainStack } from './MainStack';
import { OnboardingStack } from './OnboardingStack';

const Root = createNativeStackNavigator();

/**
 * Three-way phase switch driven by:
 *   - couple.status   ('unpaired' / 'awaiting_safeword' / 'paired' / 'severed')
 *   - session.satisfiedAt  (in-memory; never persisted)
 *
 *   onboarding : couple not yet paired or still picking a Safe Word
 *   gate       : paired, but session is locked (cold launch, background>60s,
 *                screen-lock release)
 *   main       : paired + session satisfied
 */
export function RootStack(): JSX.Element {
  const status = useCoupleStore((s) => s.status);
  const sessionSnapshot = useSafeWordSession((s) => ({
    satisfiedAt: s.satisfiedAt,
    ttlMs: s.ttlMs,
  }));
  const satisfied = isSafeWordSatisfied(sessionSnapshot);

  // Lock the session as soon as the app has been backgrounded for more
  // than 60 s — the gate re-renders automatically on the next status
  // selector tick.
  useBackgroundLock();

  const phase: 'onboarding' | 'gate' | 'main' =
    status === 'paired' ? (satisfied ? 'main' : 'gate') : 'onboarding';

  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      {phase === 'main' ? (
        <Root.Screen name="Main" component={MainStack} />
      ) : phase === 'gate' ? (
        <Root.Screen name="Gate" component={SafeWordGateRoute} />
      ) : (
        <Root.Screen name="Onboarding" component={OnboardingStack} />
      )}
    </Root.Navigator>
  );
}
