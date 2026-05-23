import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface UnlockedPostDetailProps {
  readonly body: string | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly unlockedAt: number | null;
  /** True once we know there is already an open or completed roleplay
   *  session for this saved_post — the "I tried it" CTA collapses. */
  readonly alreadyStarted: boolean;
  readonly onBack: () => void;
  readonly onTriedIt: () => void | Promise<void>;
  readonly onContinueLoop?: () => void;
}

function isLinkLike(body: string): boolean {
  return /^https?:\/\//i.test(body.trim());
}

function isoDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

/**
 * The "post your partner saved for you, now unlocked" view. Same body
 * surface as PostDetail but with the S8 "I tried it" call-to-action
 * once the post has been opened. Tapping starts a roleplay session
 * and hands off to the rating + gratitude flow.
 */
export function UnlockedPostDetail(props: UnlockedPostDetailProps): JSX.Element {
  return (
    <SafeAreaView style={styles.container} testID="screen.unlocked-post-detail">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={props.onBack}
          testID="unlocked-post-detail.back"
        >
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>For you</Text>
        <View style={styles.headerSpacer} />
      </View>

      {props.isLoading && !props.body ? (
        <View style={styles.center} testID="unlocked-post-detail.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      ) : null}
      {props.error ? (
        <Text style={styles.errorLine} testID="unlocked-post-detail.error">
          {props.error}
        </Text>
      ) : null}

      {props.body ? (
        <ScrollView contentContainerStyle={styles.content}>
          {props.unlockedAt ? (
            <Text style={styles.meta}>unlocked {isoDate(props.unlockedAt)}</Text>
          ) : null}
          {isLinkLike(props.body) ? (
            <Pressable
              accessibilityRole="link"
              testID="unlocked-post-detail.open-link"
              onPress={() => void Linking.openURL(props.body!.trim())}
              style={styles.linkBox}
            >
              <Text style={styles.linkText} numberOfLines={3}>
                {props.body.trim()}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.body} testID="unlocked-post-detail.body">
              {props.body}
            </Text>
          )}

          {props.alreadyStarted ? (
            <View style={styles.statusBox}>
              <Text style={styles.statusText} testID="unlocked-post-detail.already-started">
                You already started this loop.
              </Text>
              {props.onContinueLoop ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={props.onContinueLoop}
                  testID="unlocked-post-detail.continue-loop"
                  style={styles.continueButton}
                >
                  <Text style={styles.continueText}>Continue the loop</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={props.onTriedIt}
              testID="unlocked-post-detail.tried-it"
              style={styles.triedButton}
            >
              <Text style={styles.triedText}>I tried it</Text>
            </Pressable>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  back: { color: '#9ec5ff', fontSize: 15 },
  headerTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  headerSpacer: { width: 40 },
  content: { padding: 16, gap: 20 },
  meta: { color: '#808080', fontSize: 12, letterSpacing: 0.5 },
  body: { color: '#f5f5f5', fontSize: 17, lineHeight: 24 },
  linkBox: { backgroundColor: '#161616', padding: 14, borderRadius: 10 },
  linkText: { color: '#9ec5ff', fontSize: 15 },
  triedButton: {
    backgroundColor: '#9ec5ff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  triedText: { color: '#0a0a0a', fontWeight: '700', fontSize: 16 },
  statusBox: { gap: 12, marginTop: 12 },
  statusText: { color: '#9e9e9e', fontSize: 14, textAlign: 'center' },
  continueButton: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  continueText: { color: '#f5f5f5', fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorLine: { color: '#ffb4b4', fontSize: 13, paddingHorizontal: 16, textAlign: 'center' },
});
