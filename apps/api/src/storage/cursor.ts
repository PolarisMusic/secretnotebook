export interface PostCursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: PostCursor): string {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): PostCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { createdAt?: unknown }).createdAt === 'string' &&
      typeof (parsed as { id?: unknown }).id === 'string'
    ) {
      return parsed as PostCursor;
    }
    return null;
  } catch {
    return null;
  }
}
