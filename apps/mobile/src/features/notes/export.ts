import type { NoteKind } from './store';

/**
 * Serialize a couple's notes to CSV / JSON for archiving — used both by the
 * first-connection triage "Archive" path (item I) and the on-sever export
 * (item J). Pure string builders so they're Node-testable; the caller hands
 * the result to the native share sheet.
 */

/** The note fields worth archiving — a structural subset of NoteRow, so the
 *  store's rows can be passed straight in. */
export interface ExportableNote {
  readonly id: string;
  readonly kind: NoteKind;
  readonly body: string | null;
  /** Epoch seconds. */
  readonly createdAt: number;
  readonly revealedAt?: number | null;
}

function isoFromEpochSec(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

/** Pretty-printed JSON array of the couple's notes. */
export function notesToJson(notes: readonly ExportableNote[]): string {
  return JSON.stringify(
    notes.map((n) => ({
      id: n.id,
      kind: n.kind,
      createdAt: isoFromEpochSec(n.createdAt),
      revealed: n.revealedAt != null,
      body: n.body ?? '',
    })),
    null,
    2,
  );
}

/** Quote a CSV cell when it contains a comma, quote, CR or LF (RFC 4180). */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV (CRLF rows, RFC-4180 quoting) of the couple's notes. */
export function notesToCsv(notes: readonly ExportableNote[]): string {
  const header = ['id', 'kind', 'created_at', 'revealed', 'body'];
  const rows = notes.map((n) =>
    [n.id, n.kind, isoFromEpochSec(n.createdAt), String(n.revealedAt != null), n.body ?? '']
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n');
}
