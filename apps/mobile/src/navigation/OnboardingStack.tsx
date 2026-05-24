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
  // Initial route is chosen from the persisted connection status so that a
  // cold launch into 'awaiting_safeword' jumps straight to DefineSafeWord
  // without re-pairing.
  const initial: keyof OnboardingParamList =
    status === 'awaiting_safeword' ? 'DefineSafeWord' : 'Welcome';
  return (
    <Stack.Navigator initialRouteName={initial} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="PairWithPartner" component={PairWithPartnerRoute} />
      <Stack.Screen name="DefineSafeWord" component={DefineSafeWordRoute} />
    </Stack.Navigator>
  );
}
