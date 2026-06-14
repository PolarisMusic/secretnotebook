import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAppLockBackground } from '../features/app-lock/background';
import { isAppUnlocked, useAppLockSession } from '../features/app-lock/session';
import { AppLockGateRoute } from '../screens/auth/AppLockGateRoute';
import { useSecureScreen } from '../security/secure-screen';
import { MainStack } from './MainStack';

const Root = createNativeStackNavigator();

/**
 * Two-phase switch:
 *   - locked : biometric app-lock not yet satisfied (cold launch, or
 *              background > threshold). Shows the Face ID gate.
 *   - main   : unlocked → the notes-first app (usable paired OR unpaired;
 *              pairing is reached from the unpaired banner / Settings).
 *
 * The app no longer gates on pairing or on the Safe Word. The Safe Word is
 * being redesigned into an optional roleplay term and is not an app gate.
 * Privacy on app open is handled here by a required biometric unlock.
 */
export function RootStack(): JSX.Element {
  // Subscribe to each scalar field individually so Zustand can run Object.is
  // per field. Selecting a fresh object literal here would re-render every
  // tick and (historically) hang the JS thread + kill all touches.
  const unlockedAt = useAppLockSession((s) => s.unlockedAt);
  const ttlMs = useAppLockSession((s) => s.ttlMs);
  const unlocked = isAppUnlocked({ unlockedAt, ttlMs });

  // Re-lock after the app has been backgrounded past the threshold.
  useAppLockBackground();

  // Pin Android FLAG_SECURE across the whole app surface (iOS no-op).
  useSecureScreen();

  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      {unlocked ? (
        <Root.Screen name="Main" component={MainStack} />
      ) : (
        <Root.Screen name="AppLock" component={AppLockGateRoute} />
      )}
    </Root.Navigator>
  );
}
