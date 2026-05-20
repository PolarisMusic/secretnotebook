import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { PairWithPartnerRoute } from '../screens/onboarding/PairWithPartnerRoute';
import { WelcomeScreen } from '../screens/onboarding/WelcomeScreen';

export type OnboardingParamList = {
  Welcome: undefined;
  PairWithPartner: undefined;
};

const Stack = createNativeStackNavigator<OnboardingParamList>();

export function OnboardingStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="PairWithPartner" component={PairWithPartnerRoute} />
    </Stack.Navigator>
  );
}
