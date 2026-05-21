import type { PromptAssignOp } from '@secretnotebook/couple-protocol';
import { bytesToHex, hexToBytes } from '@secretnotebook/crypto';
import { pickPromptWeighted, PROMPT_LIBRARY, type Prompt } from '@secretnotebook/prompt-library';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from '../couple-channel/uuid';
import type { SyncEngine } from '../couple-channel/sync-engine';

/**
 * Default repeat-avoidance window — the assigner refuses to re-pick any
 * prompt whose library_key shows up in the last N rows of the local
 * prompt table. 10 is large enough to feel non-repetitive over a few
 * weeks, small enough that a couple won't exhaust the ~30 library.
 */
export const DEFAULT_AVOID_WINDOW = 10;

export interface AssignPromptArgs {
  readonly exec: SqlExecutor;
  readonly engine: SyncEngine;
  /** 32-byte pubkey of the person being assigned (the recipient). */
  readonly assignedToPubkey: Uint8Array;
  /** 32-byte pubkey of the person doing the assigning (typically self). */
  readonly assignedByPubkey: Uint8Array;
  /** Library to draw from. Defaults to PROMPT_LIBRARY; tests inject a
   *  smaller deterministic set. */
  readonly library?: ReadonlyArray<Prompt>;
  /** Repeat-avoidance window (rows). Defaults to DEFAULT_AVOID_WINDOW. */
  readonly avoidWindow?: number;
  /** Optional bias by recipient role — passthrough to the picker. */
  readonly preferForAssignee?: 'curator' | 'enactor' | 'either' | null;
  /** Inject for deterministic tests. */
  readonly random?: () => number;
  readonly idFactory?: () => Promise<string>;
  readonly now?: () => number;
}

export interface AssignedPrompt {
  readonly promptId: string;
  readonly libraryKey: string;
  readonly op: PromptAssignOp;
}

/**
 * Pick a prompt from the library, write the local `prompt` row (state =
 * 'assigned'), and enqueue a `prompt.assign` op so the partner's
 * projector mirrors the row. Mirrors the save-for-partner shape: local
 * write happens immediately, the partner catches up on the next pull
 * cycle. The shared row id collapses any future self-deliver case.
 *
 * Throws if no library key is left after filtering — caller decides
 * whether to widen the window or surface "you've run through every
 * prompt, take a breather".
 */
export async function assignPromptForPartner(args: AssignPromptArgs): Promise<AssignedPrompt> {
  if (args.assignedToPubkey.length !== 32) throw new Error('assignedToPubkey must be 32 bytes');
  if (args.assignedByPubkey.length !== 32) throw new Error('assignedByPubkey must be 32 bytes');

  const library = args.library ?? PROMPT_LIBRARY;
  const window = args.avoidWindow ?? DEFAULT_AVOID_WINDOW;
  const recent = await listRecentLibraryKeys(args.exec, window);
  const picked = pickPromptWeighted(library, {
    excludeKeys: recent,
    preferForAssignee: args.preferForAssignee ?? null,
    random: args.random,
  });

  const id = await (args.idFactory ?? randomUuidV4)();
  const createdAt = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();

  await args.exec.execute(
    `INSERT OR IGNORE INTO prompt (
       id, library_key, title, body,
       assigned_to_pubkey, assigned_by_pubkey, state
     ) VALUES (?, ?, ?, ?, ?, ?, 'assigned')`,
    [
      id,
      picked.prompt.key,
      picked.prompt.title,
      picked.prompt.body,
      args.assignedToPubkey,
      args.assignedByPubkey,
    ],
  );

  const op: PromptAssignOp = {
    v: 1,
    kind: 'prompt.assign',
    id,
    libraryKey: picked.prompt.key,
    title: picked.prompt.title,
    body: picked.prompt.body,
    assignedToPubkey: bytesToHex(args.assignedToPubkey),
    assignedByPubkey: bytesToHex(args.assignedByPubkey),
    createdAt,
  };
  await args.engine.enqueue(op);

  return { promptId: id, libraryKey: picked.prompt.key, op };
}

/**
 * Read the N most recently-assigned library_keys from the local prompt
 * table (newest first by ROWID — INSERT order). Phase-1 prompt rows
 * don't carry their own created_at; ROWID is the most accurate
 * "recent" signal we have.
 */
export async function listRecentLibraryKeys(exec: SqlExecutor, n: number): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await exec.query<{ library_key: string }>(
    `SELECT library_key FROM prompt ORDER BY ROWID DESC LIMIT ?`,
    [n],
  );
  return rows.map((r) => r.library_key);
}

/** Convenience: hex variant for callers that have hex pubkeys handy. */
export async function assignPromptForPartnerByHex(
  base: Omit<AssignPromptArgs, 'assignedToPubkey' | 'assignedByPubkey'> & {
    assignedToPubkeyHex: string;
    assignedByPubkeyHex: string;
  },
): Promise<AssignedPrompt> {
  return assignPromptForPartner({
    ...base,
    assignedToPubkey: hexToBytes(base.assignedToPubkeyHex),
    assignedByPubkey: hexToBytes(base.assignedByPubkeyHex),
  });
}
