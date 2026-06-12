import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useBackgroundLock } from '../features/safeword/background-lock';
import { isSafeWordSatisfied, useSafeWordSession } from '../features/safeword/session';
import { SafeWordGateRoute } from '../screens/auth/SafeWordGateRoute';
import { useSecureScreen } from '../security/secure-screen';
import { useConnectionStore } from '../state/connection';
import { MainStack } from './MainStack';
import { OnboardingStack } from './OnboardingStack';

const Root = createNativeStackNavigator();

/**
 * Three-way phase switch driven by:
 *   - connection.status   ('unpaired' / 'awaiting_safeword' / 'paired' / 'severed')
 *   - session.satisfiedAt  (in-memory; never persisted)
 *
 *   onboarding : connection not yet paired or still picking a Safe Word
 *   gate       : paired, but session is locked (cold launch, background>60s,
 *                screen-lock release)
 *   main       : paired + session satisfied
 */
export function RootStack(): JSX.Element {
  const status = useConnectionStore((s) => s.status);
  // Subscribe to each session field individually so Zustand can use
  // Object.is per field. Selecting an object literal here would
  // return a fresh reference on every call, fail the default
  // equality check, and trigger an infinite render loop that hangs
  // the JS thread — the entire app loses its responder system, so
  // every Pressable / TouchableOpacity / RNGH gesture silently dies
  // while native scrolling keeps working (those don't need JS to
  // advance).
  const satisfiedAt = useSafeWordSession((s) => s.satisfiedAt);
  const ttlMs = useSafeWordSession((s) => s.ttlMs);
  const satisfied = isSafeWordSatisfied({ satisfiedAt, ttlMs });

  // Lock the session as soon as the app has been backgrounded for more
  // than 60 s — the gate re-renders automatically on the next status
  // selector tick.
  useBackgroundLock();

  // Pin Android FLAG_SECURE on for the entire app surface. iOS is a
  // no-op (the OS handles recents-thumbnail blurring). See
  // apps/mobile/RUNBOOK.md §FLAG_SECURE for the prebuild patch that
  // registers the native bridge — until it's applied the hook is a
  // transparent no-op so dev / Expo-Go / Jest still work.
  useSecureScreen();

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
