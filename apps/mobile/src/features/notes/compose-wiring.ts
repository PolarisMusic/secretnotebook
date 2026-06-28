import type { PreparedAttachment } from '../attachments/types';
import {
  writeSecretNote,
  writeSharedNote,
  type NoteKind,
  type NoteRow,
  type NoteStoreDeps,
} from './store';

/**
 * Tiny dispatch helper extracted from NotesComposeRoute so the
 * Node-side Jest suite can verify the kind→store-function wiring
 * without spinning up React Native. The route forwards the form's
 * `{ kind, body }` (plus any already-prepared attachments) straight to
 * this helper; production wiring and the unit test share the same code
 * path. Attachments are encrypted + uploaded by the route BEFORE this is
 * called, so the dispatch stays a thin, synchronous-shaped pass-through.
 */
export async function submitNoteCompose(
  deps: NoteStoreDeps,
  kind: NoteKind,
  body: string,
  attachments: readonly PreparedAttachment[] = [],
  title?: string,
): Promise<NoteRow> {
  if (kind === 'shared') return writeSharedNote(deps, body, attachments, title);
  return writeSecretNote(deps, body, attachments, title);
}
