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
 * `{ kind, body }` straight to this helper; production wiring and
 * the unit test share the same code path.
 */
export async function submitNoteCompose(
  deps: NoteStoreDeps,
  kind: NoteKind,
  body: string,
): Promise<NoteRow> {
  if (kind === 'shared') return writeSharedNote(deps, body);
  return writeSecretNote(deps, body);
}
