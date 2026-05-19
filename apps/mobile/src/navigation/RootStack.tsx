import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useCoupleStore } from '../state/couple';
import { MainStack } from './MainStack';
import { OnboardingStack } from './OnboardingStack';

const Root = createNativeStackNavigator();

export function RootStack(): JSX.Element {
  const status = useCoupleStore((s) => s.status);
  const isPaired = status === 'paired';

  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      {isPaired ? (
        <Root.Screen name="Main" component={MainStack} />
      ) : (
        <Root.Screen name="Onboarding" component={OnboardingStack} />
      )}
    </Root.Navigator>
  );
}
