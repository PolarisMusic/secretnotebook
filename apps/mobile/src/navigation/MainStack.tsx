import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CoupleHomeRoute } from '../screens/couple/CoupleHomeRoute';
import { SavedByYouRoute } from '../screens/couple/SavedByYouRoute';
import { SavedForYouRoute } from '../screens/couple/SavedForYouRoute';
import { UnlockedPostDetailRoute } from '../screens/couple/UnlockedPostDetailRoute';
import { UnlockedSavedListRoute } from '../screens/couple/UnlockedSavedListRoute';
import { GlobalFeedRoute } from '../screens/feed/GlobalFeedRoute';
import { PostDetailRoute } from '../screens/feed/PostDetailRoute';
import { SubmitPostRoute } from '../screens/feed/SubmitPostRoute';
import { ActivePromptRoute } from '../screens/prompts/ActivePromptRoute';
import { CertifyCompletionRoute } from '../screens/prompts/CertifyCompletionRoute';
import { PromptListRoute } from '../screens/prompts/PromptListRoute';
import { GratitudeRoute } from '../screens/roleplay/GratitudeRoute';
import { RatingFlowRoute } from '../screens/roleplay/RatingFlowRoute';

export type MainStackParamList = {
  GlobalFeed: undefined;
  SubmitPost: undefined;
  PostDetail: { id: string };
  SavedByYou: undefined;
  SavedForYou: undefined;
  UnlockedSavedList: undefined;
  UnlockedPostDetail: { savedPostId: string };
  PromptList: undefined;
  ActivePrompt: { id: string };
  CertifyCompletion: { id: string };
  RatingFlow: { sessionId: string };
  Gratitude: { sessionId: string };
  CoupleHome: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Authenticated stack. Phase-1 surface as of S8:
 *   - Global feed loop: GlobalFeed / SubmitPost / PostDetail
 *   - Save-for-Partner: SavedByYou / SavedForYou / UnlockedSavedList /
 *     UnlockedPostDetail
 *   - Prompts: PromptList / ActivePrompt / CertifyCompletion
 *   - Roleplay close: RatingFlow / Gratitude
 *   - Couple Home (Couple Points + activity)
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
      <Stack.Screen name="UnlockedSavedList" component={UnlockedSavedListRoute} />
      <Stack.Screen name="UnlockedPostDetail" component={UnlockedPostDetailRoute} />
      <Stack.Screen name="PromptList" component={PromptListRoute} />
      <Stack.Screen name="ActivePrompt" component={ActivePromptRoute} />
      <Stack.Screen name="CertifyCompletion" component={CertifyCompletionRoute} />
      <Stack.Screen name="RatingFlow" component={RatingFlowRoute} />
      <Stack.Screen name="Gratitude" component={GratitudeRoute} />
      <Stack.Screen name="CoupleHome" component={CoupleHomeRoute} />
    </Stack.Navigator>
  );
}
