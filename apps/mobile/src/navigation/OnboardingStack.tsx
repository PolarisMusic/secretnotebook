import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { DefineSafeWordRoute } from '../screens/onboarding/DefineSafeWordRoute';
import { PairWithPartnerRoute } from '../screens/onboarding/PairWithPartnerRoute';
import { WelcomeScreen } from '../screens/onboarding/WelcomeScreen';
import { useConnectionStore } from '../state/connection';

export type OnboardingParamList = {
  Welcome: undefined;
  PairWithPartner: undefined;
  DefineSafeWord: undefined;
};

const Stack = createNativeStackNavigator<OnboardingParamList>();

export function OnboardingStack(): JSX.Element {
  const status = useConnectionStore((s) => s.status);
  // Render the screen SET declaratively from connection.status rather than
  // leaning on initialRouteName. `initialRouteName` is honoured only at
  // mount, so once this stack is mounted on Welcome/PairWithPartner a later
  // flip to 'awaiting_safeword' (the moment pairing completes) would NOT
  // advance the user — they'd sit on PairWithPartner's "Paired…" message
  // forever. Swapping the rendered screens makes React Navigation
  // re-navigate to the only available screen, both for the live transition
  // and for a cold launch that boots straight into 'awaiting_safeword'.
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {status === 'awaiting_safeword' ? (
        <Stack.Screen name="DefineSafeWord" component={DefineSafeWordRoute} />
      ) : (
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="PairWithPartner" component={PairWithPartnerRoute} />
        </>
      )}
    </Stack.Navigator>
  );
}
