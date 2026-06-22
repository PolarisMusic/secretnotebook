import { describe, expect, it } from '@jest/globals';

import { notesToCsv, notesToJson, type ExportableNote } from '../src/features/notes/export';

const NOTES: ExportableNote[] = [
  { id: 'n1', kind: 'shared', body: 'hello', createdAt: 1_700_000_000, revealedAt: null },
  {
    id: 'n2',
    kind: 'secret',
    body: 'a, b "c"\nd',
    createdAt: 1_700_000_500,
    revealedAt: 1_700_000_600,
  },
  { id: 'n3', kind: 'shared', body: null, createdAt: 1_700_000_000 },
];

describe('notes export', () => {
  it('serializes to JSON with ISO dates, a revealed flag, and empty body for null', () => {
    const parsed = JSON.parse(notesToJson(NOTES)) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ id: 'n1', kind: 'shared', body: 'hello', revealed: false });
    expect(parsed[0].createdAt).toBe('2023-11-14T22:13:20.000Z');
    expect(parsed[1].revealed).toBe(true);
    expect(parsed[2].body).toBe('');
  });

  it('serializes to CSV with a header and RFC-4180 quoting', () => {
    const csv = notesToCsv(NOTES);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,kind,created_at,revealed,body');
    expect(lines[1]).toBe('n1,shared,2023-11-14T22:13:20.000Z,false,hello');
    // comma + quotes + embedded newline → cell is quoted and quotes doubled;
    // the LF inside the cell does not start a new CSV record (split on CRLF).
    expect(csv).toContain('"a, b ""c""\nd"');
    expect(lines).toHaveLength(4); // header + 3 notes, despite the embedded LF
  });
});
