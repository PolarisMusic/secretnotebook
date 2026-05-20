import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SavedByYouRoute } from '../screens/couple/SavedByYouRoute';
import { SavedForYouRoute } from '../screens/couple/SavedForYouRoute';
import { GlobalFeedRoute } from '../screens/feed/GlobalFeedRoute';
import { PostDetailRoute } from '../screens/feed/PostDetailRoute';
import { SubmitPostRoute } from '../screens/feed/SubmitPostRoute';

export type MainStackParamList = {
  GlobalFeed: undefined;
  SubmitPost: undefined;
  PostDetail: { id: string };
  SavedByYou: undefined;
  SavedForYou: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Authenticated stack. Phase-1 surfaces the global posts loop +
 * SavedByYou / SavedForYou (S5). S6 / S8 will add prompts and the
 * couple home; S7 will turn the SavedForYou unlocked-tile tap into a
 * "browse unlocked posts" list.
 */
export function MainStack(): JSX.Element {
  return (
    <Stack.Navigator
      initialRouteName="GlobalFeed"
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}
    >
      <Stack.Screen name="GlobalFeed" component={GlobalFeedRoute} />
      <Stack.Screen
        name="SubmitPost"
        component={SubmitPostRoute}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="PostDetail" component={PostDetailRoute} />
      <Stack.Screen name="SavedByYou" component={SavedByYouRoute} />
      <Stack.Screen name="SavedForYou" component={SavedForYouRoute} />
    </Stack.Navigator>
  );
}
