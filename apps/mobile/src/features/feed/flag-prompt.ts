import type { PostFlagCategory } from '@secretnotebook/shared-types';
import { Alert } from 'react-native';

/**
 * Submit handler the caller wires to the flag API mutation. Always returns
 * a promise so the prompt can chain on completion without the void-narrowing
 * footgun.
 */
export type FlagSubmit = (
  category: PostFlagCategory,
  detail: string | undefined,
) => Promise<unknown>;

interface Choice {
  readonly label: string;
  readonly category: PostFlagCategory;
}

const CHOICES: ReadonlyArray<Choice> = [
  { label: 'Sexual content', category: 'sexual' },
  { label: 'Violence', category: 'violent' },
  { label: 'Spam', category: 'spam' },
  { label: 'Reveals personal details', category: 'reveals_personal_details' },
  { label: 'Other (specify)…', category: 'other' },
];

const REVEAL_PERSONAL_WARNING =
  "This will hide the post permanently for everyone and log the original poster's identity to moderators. Use only when the post genuinely discloses someone's personal details. Continue?";

/**
 * Present the category picker for a feed flag. On a user-confirmed pick:
 *   - 'other' → second prompt for a free-text reason (iOS-only Alert.prompt;
 *     on Android, falls back to a fixed generic detail and a TODO surface).
 *   - 'reveals_personal_details' → an extra "are you sure?" confirmation
 *     because the action is irreversible and logs the original poster.
 *   - any other → submit immediately.
 *
 * The picker uses Alert.alert / Alert.prompt rather than a custom Modal so
 * the shape stays minimal and consistent with the existing notes-delete
 * confirmation pattern. Cross-platform note: Alert.prompt is iOS-only — a
 * follow-up may swap this for a small Modal-based FlagSheet to support
 * Android text input properly. Until then Android testers can't supply a
 * detail and the 'other' submit falls back to a static placeholder.
 */
export async function promptForFlag(submit: FlagSubmit): Promise<void> {
  return new Promise((resolve) => {
    Alert.alert(
      'Flag this post',
      'Why are you reporting it? This obscures the post for everyone.',
      [
        ...CHOICES.map((c) => ({
          text: c.label,
          onPress: () => {
            void handlePick(c.category, submit).finally(resolve);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve() },
      ],
    );
  });
}

async function handlePick(category: PostFlagCategory, submit: FlagSubmit): Promise<void> {
  if (category === 'other') {
    await promptDetail(submit);
    return;
  }
  if (category === 'reveals_personal_details') {
    await confirmRevealsPersonal(submit);
    return;
  }
  await submit(category, undefined);
}

async function promptDetail(submit: FlagSubmit): Promise<void> {
  // Alert.prompt only exists on iOS; on Android we fall back to a static
  // detail so the request still satisfies the server schema. Tracked TODO.
  const promptFn = (Alert as { prompt?: typeof Alert.prompt }).prompt;
  if (!promptFn) {
    await submit('other', '(no detail provided — Android)');
    return;
  }
  await new Promise<void>((resolve) => {
    promptFn(
      'Other reason',
      'Briefly explain why this post should be removed.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
        {
          text: 'Submit',
          onPress: (text) => {
            const detail = (text ?? '').trim();
            if (detail.length === 0) {
              Alert.alert('Detail required', 'Please briefly explain the reason.');
              resolve();
              return;
            }
            void submit('other', detail).finally(resolve);
          },
        },
      ],
      'plain-text',
    );
  });
}

async function confirmRevealsPersonal(submit: FlagSubmit): Promise<void> {
  await new Promise<void>((resolve) => {
    Alert.alert('Confirm', REVEAL_PERSONAL_WARNING, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
      {
        text: 'Flag and log',
        style: 'destructive',
        onPress: () => {
          void submit('reveals_personal_details', undefined).finally(resolve);
        },
      },
    ]);
  });
}
