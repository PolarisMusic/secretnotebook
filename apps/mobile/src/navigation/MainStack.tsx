import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ConnectionHomeRoute } from '../screens/connection/ConnectionHomeRoute';
import { SavedByYouRoute } from '../screens/connection/SavedByYouRoute';
import { GlobalFeedRoute } from '../screens/feed/GlobalFeedRoute';
import { PostDetailRoute } from '../screens/feed/PostDetailRoute';
import { SubmitPostRoute } from '../screens/feed/SubmitPostRoute';

export type MainStackParamList = {
  GlobalFeed: undefined;
  SubmitPost: undefined;
  PostDetail: { id: string };
  SavedByYou: undefined;
  ConnectionHome: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Authenticated stack. Phase-1.5 R0 surface (post couple-loop cleanup):
 *   - Global feed loop: GlobalFeed / SubmitPost / PostDetail
 *   - Personal saved list: SavedByYou (proto-pin surface)
 *   - Connection Home (ledger placeholder)
 *
 * The roleplay / prompt / unlocked-saved / saved-for-partner screens
 * are gone with the couple-loop cleanup; they're replaced in R2+ by
 * the notes + publish flows.
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
      <Stack.Screen name="ConnectionHome" component={ConnectionHomeRoute} />
    </Stack.Navigator>
  );
}
