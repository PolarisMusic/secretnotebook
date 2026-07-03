import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SafeWordAlert } from '../components/SafeWordAlert';
import { SeverBanner } from '../components/SeverBanner';
import { SavedByYouRoute } from '../screens/connection/SavedByYouRoute';
import { GlobalFeedRoute } from '../screens/feed/GlobalFeedRoute';
import { PostDetailRoute } from '../screens/feed/PostDetailRoute';
import { SubmitPostRoute } from '../screens/feed/SubmitPostRoute';
import { NotesComposeRoute } from '../screens/notes/NotesComposeRoute';
import { NotesDetailRoute } from '../screens/notes/NotesDetailRoute';
import { NotesEditRoute } from '../screens/notes/NotesEditRoute';
import { NotesListRoute } from '../screens/notes/NotesListRoute';
import { NotesTriageRoute } from '../screens/notes/NotesTriageRoute';
import { OnboardingCategoriesRoute } from '../screens/onboarding/OnboardingCategoriesRoute';
import { OnboardingRoleRoute } from '../screens/onboarding/OnboardingRoleRoute';
import { OnboardingSafeWordRoute } from '../screens/onboarding/OnboardingSafeWordRoute';
import { PairWithPartnerRoute } from '../screens/onboarding/PairWithPartnerRoute';
import { SafeWordRoute } from '../screens/safeword/SafeWordRoute';
import { PromptPreferencesRoute } from '../screens/secret-unlock/PromptPreferencesRoute';
import { SecretUnlockDetailRoute } from '../screens/secret-unlock/SecretUnlockDetailRoute';
import { SecretUnlockListRoute } from '../screens/secret-unlock/SecretUnlockListRoute';
import { SettingsRoute } from '../screens/settings/SettingsRoute';

export type MainStackParamList = {
  NotesList: undefined;
  /** `draftId` present ⇒ edit that pending draft in place; absent ⇒ new note. */
  NotesCompose: { draftId?: string } | undefined;
  NotesDetail: { id: string };
  NotesEdit: { id: string };
  NotesTriage: undefined;
  GlobalFeed: undefined;
  SubmitPost: undefined;
  PostDetail: { id: string; savedPostId?: string };
  SavedByYou: undefined;
  SecretUnlockList: undefined;
  SecretUnlockDetail: { id: string; intro?: boolean };
  PromptPreferences: undefined;
  Settings: undefined;
  SafeWord: undefined;
  Pairing: undefined;
  OnboardingRole: undefined;
  OnboardingCategories: undefined;
  OnboardingSafeWord: undefined;
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
    <>
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
        <Stack.Screen
          name="NotesEdit"
          component={NotesEditRoute}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen name="NotesTriage" component={NotesTriageRoute} />
        <Stack.Screen name="GlobalFeed" component={GlobalFeedRoute} />
        <Stack.Screen
          name="SubmitPost"
          component={SubmitPostRoute}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen name="PostDetail" component={PostDetailRoute} />
        <Stack.Screen name="SavedByYou" component={SavedByYouRoute} />
        <Stack.Screen name="SecretUnlockList" component={SecretUnlockListRoute} />
        <Stack.Screen name="SecretUnlockDetail" component={SecretUnlockDetailRoute} />
        <Stack.Screen name="PromptPreferences" component={PromptPreferencesRoute} />
        <Stack.Screen name="Settings" component={SettingsRoute} />
        <Stack.Screen name="SafeWord" component={SafeWordRoute} />
        <Stack.Screen
          name="Pairing"
          component={PairWithPartnerRoute}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen name="OnboardingRole" component={OnboardingRoleRoute} />
        <Stack.Screen name="OnboardingCategories" component={OnboardingCategoriesRoute} />
        <Stack.Screen name="OnboardingSafeWord" component={OnboardingSafeWordRoute} />
      </Stack.Navigator>
      {/* App-wide: an inbound safe-word trigger overlays every screen until
          it's acknowledged. */}
      <SafeWordAlert />
      {/* App-wide: a pending connection sever shows a grace countdown +
          undo/end-now until it resolves. */}
      <SeverBanner />
    </>
  );
}
