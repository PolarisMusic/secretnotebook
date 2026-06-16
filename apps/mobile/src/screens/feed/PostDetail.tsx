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
  /** Report this post for moderation (the Route prompts for a category). */
  readonly onFlag: (id: string) => void;
}

function isLinkLike(body: string): boolean {
  return /^https?:\/\//i.test(body.trim());
}

export function PostDetail(props: PostDetailProps): JSX.Element {
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
          {props.post.flags.length > 0 ? (
            <Text style={styles.obscured} testID="post-detail.obscured">
              ⚠️ Content hidden — flagged as {props.post.flags.join(', ')}
            </Text>
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
          ) : (
            <Text style={styles.body} testID="post-detail.body">
              {props.post.body}
            </Text>
          )}
          <Text style={styles.author}>by {props.post.anonAuthor.slice(0, 16)}…</Text>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => props.onHide(props.post!.id)}
              testID="post-detail.hide"
            >
              <Text style={styles.actionText}>Hide for me</Text>
            </Pressable>
            {props.post.flags.length === 0 && (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => props.onFlag(props.post!.id)}
                testID="post-detail.flag"
              >
                <Text style={styles.actionText}>Flag</Text>
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
