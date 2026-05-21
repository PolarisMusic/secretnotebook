import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SavedByYouRoute } from '../screens/couple/SavedByYouRoute';
import { SavedForYouRoute } from '../screens/couple/SavedForYouRoute';
import { GlobalFeedRoute } from '../screens/feed/GlobalFeedRoute';
import { PostDetailRoute } from '../screens/feed/PostDetailRoute';
import { SubmitPostRoute } from '../screens/feed/SubmitPostRoute';
import { ActivePromptRoute } from '../screens/prompts/ActivePromptRoute';
import { CertifyCompletionRoute } from '../screens/prompts/CertifyCompletionRoute';
import { PromptListRoute } from '../screens/prompts/PromptListRoute';

export type MainStackParamList = {
  GlobalFeed: undefined;
  SubmitPost: undefined;
  PostDetail: { id: string };
  SavedByYou: undefined;
  SavedForYou: undefined;
  PromptList: undefined;
  ActivePrompt: { id: string };
  CertifyCompletion: { id: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Authenticated stack. Phase-1 now surfaces the global posts loop
 * (S3), saved-for-partner (S5), and prompts (S6). S7 turns the
 * SavedForYou unlocked tile into a browse list; S8 adds the
 * rate + gratitude + Couple Points home.
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
      <Stack.Screen name="PromptList" component={PromptListRoute} />
      <Stack.Screen name="ActivePrompt" component={ActivePromptRoute} />
      <Stack.Screen name="CertifyCompletion" component={CertifyCompletionRoute} />
    </Stack.Navigator>
  );
}
