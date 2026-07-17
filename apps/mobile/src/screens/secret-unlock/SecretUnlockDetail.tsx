import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { UnlockState } from '../../features/secret-unlock/store';

export interface ReflectionView {
  readonly appreciate: string;
  readonly uncomfortable: string;
}

export interface PromptSourceView {
  readonly name: string | null;
  readonly url: string | null;
  readonly sponsored: boolean;
}

export interface SecretUnlockDetailProps {
  readonly loading: boolean;
  readonly role: 'author' | 'unlocker';
  readonly state: UnlockState;
  readonly promptText: string;
  /** Whether to render the prompt text at all. The Author is blind to the
   *  drawn prompt until the Unlocker submits ("asks for verification"). */
  readonly showPrompt: boolean;
  /** When non-null, the prompt card flashes through these random snippets
   *  before settling on `promptText` — the on-start "shuffle" animation. */
  readonly shuffleTexts: readonly string[] | null;
  /** Bumped each time the shuffle should (re)play — once on the intro draw
   *  and again on every re-roll. The card replays whenever this changes and
   *  `shuffleTexts` is present, so re-rolling animates like a fresh draw. */
  readonly animationKey: number;
  /** Optional source attribution for the prompt — surfaced under the
   *  card when the prompt came from a named external library. Null for
   *  bundled prompts. */
  readonly promptSource: PromptSourceView | null;
  /** The revealed secret's body, or null (media-only / not yet readable here). */
  readonly revealedBody: string | null;
  readonly revealedHasMedia: boolean;
  /** Whether to render the revealed-secret block at all. */
  readonly showSecret: boolean;
  /** Author has reached reflection but hasn't disclosed which secret yet. */
  readonly authorMustDisclose: boolean;
  readonly myReflection: ReflectionView | null;
  readonly partnerReflection: ReflectionView | null;
  readonly complete: boolean;
  readonly busy: boolean;
  /** Current re-roll token balance (shown to Unlocker in 'assigned'/'returned'). */
  readonly rerollBalance: number;
  /** Whether to offer "Undo cancel" — Unlocker only, until the daily cap
   *  resets at local midnight. */
  readonly canUndoCancel: boolean;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly onUndoCancel: () => void;
  readonly onVerify: () => void;
  readonly onReject: () => void;
  readonly onDisclose: () => void;
  readonly onReflect: (appreciate: string, uncomfortable: string) => void;
  /** Re-roll the current prompt (Unlocker only, pre-submit). */
  readonly onReroll: () => void;
  readonly onBack: () => void;
}

const SHUFFLE_TICK_MS = 150;
const SHUFFLE_TICKS = 9;

function PromptCard(props: {
  role: 'author' | 'unlocker';
  promptText: string;
  shuffleTexts: readonly string[] | null;
  promptSource: PromptSourceView | null;
  animationKey: number;
}): JSX.Element {
  // `tick` counts up while the shuffle plays; null means settled on the
  // real prompt. The shuffle (re)fires whenever `animationKey` changes and
  // `shuffleTexts` is present — the intro draw and every re-roll bump it.
  // A re-open of a settled unlock keeps the key steady, so it stays static.
  const [tick, setTick] = useState<number | null>(
    props.shuffleTexts && props.shuffleTexts.length > 0 ? 0 : null,
  );
  useEffect(() => {
    if (!props.shuffleTexts || props.shuffleTexts.length === 0) {
      setTick(null);
      return;
    }
    setTick(0);
    const handle = setInterval(() => {
      setTick((prev) => {
        if (prev == null) return null;
        if (prev + 1 >= SHUFFLE_TICKS) {
          clearInterval(handle);
          return null;
        }
        return prev + 1;
      });
    }, SHUFFLE_TICK_MS);
    return () => clearInterval(handle);
    // Keyed on the animation epoch only: shuffleTexts changes in lockstep
    // with animationKey, so keying on both would double-fire the shuffle.
  }, [props.animationKey]);

  const display =
    tick != null && props.shuffleTexts && props.shuffleTexts.length > 0
      ? (props.shuffleTexts[tick % props.shuffleTexts.length] ?? props.promptText)
      : props.promptText;

  const source = props.promptSource;
  const showSource = tick == null && source && (source.name || source.sponsored);
  return (
    <View style={styles.card} testID="unlock.prompt">
      <Text style={styles.cardTitle}>
        {props.role === 'unlocker' ? 'Your prompt' : 'Their prompt'}
      </Text>
      <Text style={[styles.prompt, tick != null && styles.promptShuffling]}>{display}</Text>
      {showSource && (
        <View style={styles.sourceRow} testID="unlock.prompt.source">
          {source!.sponsored && <Text style={styles.sponsoredBadge}>SPONSORED</Text>}
          {source!.name && (
            <Text style={styles.sourceText}>
              From{' '}
              {source!.url ? (
                <Text style={styles.sourceLink} onPress={() => void Linking.openURL(source!.url!)}>
                  {source!.name}
                </Text>
              ) : (
                source!.name
              )}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function ReflectionForm(props: {
  busy: boolean;
  onSubmit: (a: string, u: string) => void;
}): JSX.Element {
  const [appreciate, setAppreciate] = useState('');
  const [uncomfortable, setUncomfortable] = useState('');
  const canSubmit = appreciate.trim().length > 0 && uncomfortable.trim().length > 0 && !props.busy;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Reflect together</Text>
      <Text style={styles.question}>What did you appreciate about this note?</Text>
      <TextInput
        style={styles.input}
        multiline
        placeholder="Share what landed for you…"
        placeholderTextColor="#5a5a5a"
        value={appreciate}
        onChangeText={setAppreciate}
        testID="unlock.reflect.appreciate"
      />
      <Text style={styles.question}>Did anything make you feel uncomfortable about this note?</Text>
      <TextInput
        style={styles.input}
        multiline
        placeholder="Be honest — even “nothing” is an answer."
        placeholderTextColor="#5a5a5a"
        value={uncomfortable}
        onChangeText={setUncomfortable}
        testID="unlock.reflect.uncomfortable"
      />
      <Pressable
        accessibilityRole="button"
        disabled={!canSubmit}
        style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
        onPress={() => props.onSubmit(appreciate, uncomfortable)}
        testID="unlock.reflect.submit"
      >
        <Text style={[styles.primaryBtnText, !canSubmit && styles.btnTextDisabled]}>
          Submit reflection
        </Text>
      </Pressable>
    </View>
  );
}

function ReflectionReadout({
  title,
  reflection,
}: {
  title: string;
  reflection: ReflectionView;
}): JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.readLabel}>Appreciated</Text>
      <Text style={styles.readText}>{reflection.appreciate}</Text>
      <Text style={styles.readLabel}>Uncomfortable</Text>
      <Text style={styles.readText}>{reflection.uncomfortable}</Text>
    </View>
  );
}

/**
 * One unlock attempt, rendered for whichever role + state it's in. The
 * prompt is always shown; the action block and the revealed-secret /
 * reflection sections switch on state. The Author only sees which secret
 * was drawn after they tap "Reveal which secret" at reflection time.
 */
export function SecretUnlockDetail(props: SecretUnlockDetailProps): JSX.Element {
  if (props.loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center} testID="unlock.detail.loading">
          <ActivityIndicator color="#f5f5f5" />
        </View>
      </SafeAreaView>
    );
  }
  const { role, state } = props;
  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="screen.unlock_detail">
      <View style={styles.bar}>
        <Pressable
          hitSlop={12}
          onPress={props.onBack}
          style={styles.back}
          testID="unlock.detail.back"
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Unlock</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {props.showPrompt ? (
          <PromptCard
            role={role}
            promptText={props.promptText}
            shuffleTexts={props.shuffleTexts}
            promptSource={props.promptSource}
            animationKey={props.animationKey}
          />
        ) : (
          <View style={styles.card} testID="unlock.prompt.hidden">
            <Text style={styles.cardTitle}>Their prompt</Text>
            <Text style={styles.note}>
              Your partner is working on a prompt. You'll see what it was when they ask you to
              verify.
            </Text>
          </View>
        )}

        {/* Action block by state. */}
        {(state === 'assigned' || state === 'returned') && role === 'unlocker' && (
          <View style={styles.card}>
            {state === 'returned' && (
              <Text style={styles.note}>Your partner sent this back. Give it another go.</Text>
            )}
            <Text style={styles.note}>Do the prompt in real life, then mark it done.</Text>
            <Pressable
              accessibilityRole="button"
              disabled={props.busy}
              style={[styles.primaryBtn, props.busy && styles.btnDisabled]}
              onPress={props.onSubmit}
              testID="unlock.submit"
            >
              <Text style={styles.primaryBtnText}>I did it — mark done</Text>
            </Pressable>
            {props.rerollBalance > 0 && (
              <Pressable
                accessibilityRole="button"
                disabled={props.busy}
                style={[styles.ghostBtn, props.busy && styles.btnDisabled]}
                onPress={props.onReroll}
                testID="unlock.reroll"
              >
                <Text style={styles.ghostBtnText}>Re-roll prompt ({props.rerollBalance} left)</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={props.busy}
              style={styles.ghostBtn}
              onPress={props.onCancel}
              testID="unlock.cancel"
            >
              <Text style={styles.ghostBtnText}>Cancel unlock</Text>
            </Pressable>
          </View>
        )}

        {(state === 'assigned' || state === 'returned') && role === 'author' && (
          <View style={styles.card}>
            <Text style={styles.note}>Waiting for your partner to do the prompt.</Text>
          </View>
        )}

        {state === 'submitted' && role === 'unlocker' && (
          <View style={styles.card}>
            <Text style={styles.note}>Done! Waiting for your partner to verify.</Text>
            <Pressable
              accessibilityRole="button"
              disabled={props.busy}
              style={styles.ghostBtn}
              onPress={props.onCancel}
              testID="unlock.cancel"
            >
              <Text style={styles.ghostBtnText}>Cancel unlock</Text>
            </Pressable>
          </View>
        )}

        {state === 'submitted' && role === 'author' && (
          <View style={styles.card}>
            <Text style={styles.note}>
              Your partner says they did it. Verify to reveal one of your secret notes to them (+500
              Sparks). You won't be told which one until you reflect.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={props.busy}
              style={[styles.primaryBtn, props.busy && styles.btnDisabled]}
              onPress={props.onVerify}
              testID="unlock.verify"
            >
              <Text style={styles.primaryBtnText}>Verify &amp; reveal</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={props.busy}
              style={styles.ghostBtn}
              onPress={props.onReject}
              testID="unlock.reject"
            >
              <Text style={styles.ghostBtnText}>Send back to redo</Text>
            </Pressable>
          </View>
        )}

        {state === 'canceled' && (
          <View style={styles.card}>
            <Text style={styles.note}>This unlock was canceled.</Text>
            {props.canUndoCancel && (
              <>
                <Text style={styles.note}>
                  Changed your mind? You can undo this until tomorrow.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={props.busy}
                  style={[styles.primaryBtn, props.busy && styles.btnDisabled]}
                  onPress={props.onUndoCancel}
                  testID="unlock.undo-cancel"
                >
                  <Text style={styles.primaryBtnText}>Undo cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* Revealed: the secret + reflection. */}
        {state === 'revealed' && (
          <>
            {props.authorMustDisclose ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>One of your secrets was unlocked</Text>
                <Text style={styles.note}>
                  Your partner has read one of your secret notes. Reveal which one to reflect on it
                  together.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={props.busy}
                  style={[styles.primaryBtn, props.busy && styles.btnDisabled]}
                  onPress={props.onDisclose}
                  testID="unlock.disclose"
                >
                  <Text style={styles.primaryBtnText}>Reveal which secret</Text>
                </Pressable>
              </View>
            ) : props.showSecret ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {role === 'unlocker' ? 'The secret you unlocked' : 'The secret that was unlocked'}
                </Text>
                {props.revealedBody != null && (
                  <Text style={styles.secret}>{props.revealedBody}</Text>
                )}
                {props.revealedHasMedia && (
                  <Text style={styles.note}>
                    This note has media — open it in Notes to view{props.revealedBody ? ' it' : ''}.
                  </Text>
                )}
              </View>
            ) : null}

            {props.complete && (
              <View style={styles.bannerDone} testID="unlock.complete">
                <Text style={styles.bannerDoneText}>
                  Reflection complete — +500 Sparks earned together. ✨
                </Text>
              </View>
            )}

            {/* Reflection: form until I've reflected, then a readout. The Author
                must disclose first so they can reflect on the actual note. */}
            {props.myReflection != null ? (
              <ReflectionReadout title="Your reflection" reflection={props.myReflection} />
            ) : !props.authorMustDisclose ? (
              <ReflectionForm busy={props.busy} onSubmit={props.onReflect} />
            ) : null}

            {props.partnerReflection != null && (
              <ReflectionReadout title="Their reflection" reflection={props.partnerReflection} />
            )}
            {props.myReflection != null && props.partnerReflection == null && (
              <Text style={styles.note}>Waiting for your partner's reflection…</Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { color: '#f5f5f5', fontSize: 34, lineHeight: 36 },
  title: { color: '#f5f5f5', fontSize: 20, fontWeight: '700', flex: 1, textAlign: 'center' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: '#161616', borderRadius: 12, padding: 16, gap: 10 },
  cardTitle: { color: '#9ec5ff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  prompt: { color: '#f5f5f5', fontSize: 18, lineHeight: 25 },
  promptShuffling: { opacity: 0.45 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sourceText: { color: '#9e9e9e', fontSize: 12 },
  sourceLink: { color: '#9ec5ff', textDecorationLine: 'underline' },
  sponsoredBadge: {
    color: '#0a0a0a',
    backgroundColor: '#e0b86a',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  note: { color: '#b5b5b5', fontSize: 14, lineHeight: 20 },
  secret: { color: '#f5f5f5', fontSize: 16, lineHeight: 23 },
  question: { color: '#cdcdcd', fontSize: 14, fontWeight: '600', marginTop: 4 },
  input: {
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    color: '#f5f5f5',
    fontSize: 15,
    padding: 12,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    backgroundColor: '#2a2a3a',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#cdd6ff', fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  btnTextDisabled: { color: '#8a8a8a' },
  ghostBtn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  ghostBtnText: { color: '#9a9a9a', fontSize: 14, fontWeight: '600' },
  readLabel: {
    color: '#808080',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  readText: { color: '#e5e5e5', fontSize: 15, lineHeight: 21 },
  bannerDone: { backgroundColor: '#16241a', borderRadius: 10, padding: 14 },
  bannerDoneText: { color: '#9eff9e', fontSize: 14, fontWeight: '600', lineHeight: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
