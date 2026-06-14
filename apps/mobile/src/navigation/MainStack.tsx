import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SavedByYouRoute } from '../screens/connection/SavedByYouRoute';
import { GlobalFeedRoute } from '../screens/feed/GlobalFeedRoute';
import { PostDetailRoute } from '../screens/feed/PostDetailRoute';
import { SubmitPostRoute } from '../screens/feed/SubmitPostRoute';
import { NotesComposeRoute } from '../screens/notes/NotesComposeRoute';
import { NotesDetailRoute } from '../screens/notes/NotesDetailRoute';
import { NotesListRoute } from '../screens/notes/NotesListRoute';
import { PairWithPartnerRoute } from '../screens/onboarding/PairWithPartnerRoute';
import { SettingsRoute } from '../screens/settings/SettingsRoute';

export type MainStackParamList = {
  NotesList: undefined;
  NotesCompose: undefined;
  NotesDetail: { id: string };
  GlobalFeed: undefined;
  SubmitPost: undefined;
  PostDetail: { id: string };
  SavedByYou: undefined;
  Settings: undefined;
  Pairing: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Notes-first app surface. Opens on Notes (the core product); Feed, Saved,
 * and Settings are reached through the overlay hamburger menu. Pairing is a
 * dismissible modal reached from the unpaired banner / Settings — it is no
 * longer a gate.
 */
export function MainStack(): JSX.Element {
  return (
    <Stack.Navigator
      initialRouteName="NotesList"
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}
    >
      <Stack.Screen name="NotesList" component={NotesListRoute} />
      <Stack.Screen
        name="NotesCompose"
        component={NotesComposeRoute}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="NotesDetail" component={NotesDetailRoute} />
      <Stack.Screen name="GlobalFeed" component={GlobalFeedRoute} />
      <Stack.Screen
        name="SubmitPost"
        component={SubmitPostRoute}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="PostDetail" component={PostDetailRoute} />
      <Stack.Screen name="SavedByYou" component={SavedByYouRoute} />
      <Stack.Screen name="Settings" component={SettingsRoute} />
      <Stack.Screen
        name="Pairing"
        component={PairWithPartnerRoute}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
