import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Post } from '@secretnotebook/shared-types';

export interface PostDetailProps {
  readonly post: Post | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly onBack: () => void;
  /** Hide this post for me (local). */
  readonly onHide: (id: string) => void;
  /** Reverse a local hide. */
  readonly onUnhide: (id: string) => void;
  /** Report this post for moderation (the Route prompts for a category). */
  readonly onFlag: (id: string) => void;
  /** Copy this post's text into the couple's notes. The Route prompts for
   *  shared vs secret; absent when there's no connection to save into. */
  readonly onSaveToNotes?: (id: string) => void;
  /** Whether the viewer has locally hidden this post. */
  readonly hiddenLocally: boolean;
}

function isLinkLike(body: string): boolean {
  return /^https?:\/\//i.test(body.trim());
}

export function PostDetail(props: PostDetailProps): JSX.Element {
  // Per-render override: the viewer can opt to see a hidden / non-personal
  // flagged body anyway. Hardly any state — and importantly NOT persisted —
  // so leaving the screen resets it.
  const [showAnyway, setShowAnyway] = useState(false);

  const revealsPersonal = props.post?.flags.includes('reveals_personal_details') ?? false;
  const flagged = (props.post?.flags.length ?? 0) > 0;
  const hiddenLocally = props.hiddenLocally;
  // Some flag is suppressing the body; viewer can override unless it's the
  // strict tier.
  const obscured = flagged || hiddenLocally;
  const canShowAnyway = obscured && !revealsPersonal;
  const showBody = !obscured || (showAnyway && canShowAnyway);

  // For server-flagged posts the body is the empty string (the API withholds
  // it once flagged), so "show anyway" only meaningfully reveals locally-
  // hidden posts. Surfaced in the UI text so a tap on a flagged-but-empty
  // post isn't surprising.
  const bodyAvailable = (props.post?.body.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.container} testID="screen.post-detail">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="post-detail.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
      </View>

      {props.isLoading && !props.post ? (
        <View style={styles.center} testID="post-detail.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      ) : null}

      {props.error && !props.post ? (
        <View style={styles.center} testID="post-detail.error">
          <Text style={styles.errorText}>Couldn't load this post: {props.error.message}</Text>
        </View>
      ) : null}

      {props.post ? (
        <View style={styles.content}>
          <Text style={styles.meta}>
            {props.post.contentType.toUpperCase()} ·{' '}
            {new Date(props.post.createdAt).toISOString().slice(0, 10)}
          </Text>

          {revealsPersonal ? (
            <Text style={styles.obscured} testID="post-detail.reveals_personal">
              ⛔ Hidden permanently — flagged as revealing personal details. The viewer cannot
              override this.
            </Text>
          ) : obscured && !showAnyway ? (
            <View style={styles.collapsed} testID="post-detail.collapsed">
              <Text style={styles.obscured}>
                {flagged ? `⚠️ Flagged as ${props.post.flags.join(', ')}.` : '· Hidden by you ·'}
              </Text>
              {bodyAvailable ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setShowAnyway(true)}
                  testID="post-detail.show-anyway"
                  style={styles.showAnywayBtn}
                >
                  <Text style={styles.showAnywayText}>Show anyway</Text>
                </Pressable>
              ) : (
                <Text style={styles.author}>
                  Body withheld by the server — there's nothing to reveal locally.
                </Text>
              )}
            </View>
          ) : props.post.contentType === 'link' && isLinkLike(props.post.body) ? (
            <Pressable
              accessibilityRole="link"
              testID="post-detail.open-link"
              onPress={() => void Linking.openURL(props.post!.body.trim())}
              style={styles.linkBox}
            >
              <Text style={styles.linkText} numberOfLines={2}>
                {props.post.body.trim()}
              </Text>
            </Pressable>
          ) : showBody ? (
            <Text style={styles.body} testID="post-detail.body">
              {props.post.body}
            </Text>
          ) : null}

          <Text style={styles.author}>by {props.post.anonAuthor.slice(0, 16)}…</Text>

          <View style={styles.actions}>
            {hiddenLocally ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  setShowAnyway(false);
                  props.onUnhide(props.post!.id);
                }}
                testID="post-detail.unhide"
              >
                <Text style={styles.actionText}>Unhide</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => props.onHide(props.post!.id)}
                testID="post-detail.hide"
              >
                <Text style={styles.actionText}>Hide for me</Text>
              </Pressable>
            )}
            {!flagged && (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => props.onFlag(props.post!.id)}
                testID="post-detail.flag"
              >
                <Text style={styles.actionText}>Flag</Text>
              </Pressable>
            )}
            {props.onSaveToNotes && !flagged && !hiddenLocally && (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => props.onSaveToNotes!(props.post!.id)}
                testID="post-detail.save-to-notes"
              >
                <Text style={styles.actionText}>Save to notes</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  back: { color: '#9ec5ff', fontSize: 15 },
  content: { padding: 16, gap: 16 },
  meta: { color: '#808080', fontSize: 12, letterSpacing: 0.5 },
  body: { color: '#f5f5f5', fontSize: 17, lineHeight: 24 },
  obscured: { color: '#ffb4b4', fontSize: 16, fontStyle: 'italic', lineHeight: 23 },
  collapsed: { gap: 10 },
  showAnywayBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  showAnywayText: { color: '#9ec5ff', fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 20, marginTop: 8 },
  actionText: { color: '#9ec5ff', fontSize: 15, fontWeight: '600' },
  linkBox: {
    backgroundColor: '#161616',
    padding: 14,
    borderRadius: 10,
  },
  linkText: { color: '#9ec5ff', fontSize: 15 },
  author: { color: '#5e5e5e', fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  errorText: { color: '#ffb4b4', fontSize: 14, textAlign: 'center' },
});
