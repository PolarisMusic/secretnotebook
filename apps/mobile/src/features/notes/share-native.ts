import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Write a text archive (CSV / JSON from notes/export.ts) to a temp file and
 * open the system share sheet. The only native bit of the notes-archive
 * flow — no Jest runtime, so verify on device per apps/mobile/RUNBOOK.md.
 *
 * Best-effort: resolves to `false` (without throwing) when sharing isn't
 * available on the platform, so callers can carry on (e.g. still schedule a
 * sever) if the export couldn't be surfaced.
 */
export async function shareTextFile(
  filename: string,
  content: string,
  mimeType: string,
): Promise<boolean> {
  const uri = `${FileSystem.cacheDirectory ?? ''}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, {
    mimeType,
    dialogTitle: 'Export your notes',
    UTI: mimeType === 'application/json' ? 'public.json' : 'public.comma-separated-values-text',
  });
  return true;
}
