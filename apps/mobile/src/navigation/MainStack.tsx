import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ConnectionHomeRoute } from '../screens/connection/ConnectionHomeRoute';
import { SavedByYouRoute } from '../screens/connection/SavedByYouRoute';
import { GlobalFeedRoute } from '../screens/feed/GlobalFeedRoute';
import { PostDetailRoute } from '../screens/feed/PostDetailRoute';
import { SubmitPostRoute } from '../screens/feed/SubmitPostRoute';
import { NotesComposeRoute } from '../screens/notes/NotesComposeRoute';
import { NotesDetailRoute } from '../screens/notes/NotesDetailRoute';
import { NotesListRoute } from '../screens/notes/NotesListRoute';

export type MainStackParamList = {
  GlobalFeed: undefined;
  SubmitPost: undefined;
  PostDetail: { id: string };
  SavedByYou: undefined;
  ConnectionHome: undefined;
  NotesList: undefined;
  NotesCompose: undefined;
  NotesDetail: { id: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Authenticated stack. Phase-1.6 surface:
 *   - Global feed loop: GlobalFeed / SubmitPost / PostDetail
 *   - Personal saved list: SavedByYou (proto-pin surface)
 *   - Connection Home (role + ledger placeholder)
 *   - Notes loop: NotesList / NotesCompose (modal) / NotesDetail
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
      <Stack.Screen name="NotesList" component={NotesListRoute} />
      <Stack.Screen
        name="NotesCompose"
        component={NotesComposeRoute}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="NotesDetail" component={NotesDetailRoute} />
    </Stack.Navigator>
  );
}
