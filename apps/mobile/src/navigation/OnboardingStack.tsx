import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { WelcomeScreen } from '../screens/onboarding/WelcomeScreen';

const Stack = createNativeStackNavigator();

export function OnboardingStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
    </Stack.Navigator>
  );
}
