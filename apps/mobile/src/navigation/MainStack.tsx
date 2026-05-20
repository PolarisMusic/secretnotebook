import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { GlobalFeedRoute } from '../screens/feed/GlobalFeedRoute';
import { PostDetailRoute } from '../screens/feed/PostDetailRoute';
import { SubmitPostRoute } from '../screens/feed/SubmitPostRoute';

export type MainStackParamList = {
  GlobalFeed: undefined;
  SubmitPost: undefined;
  PostDetail: { id: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Authenticated stack. Phase-1 surfaces just the global posts loop;
 * S5 / S6 / S8 will add saved-posts, prompts, and the couple home.
 *
 * GlobalFeed is the landing screen because the Phase-1 happy path
 * starts with browsing the global feed, picking something to save for
 * a partner (S5), and following the prompt loop from there.
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
    </Stack.Navigator>
  );
}
