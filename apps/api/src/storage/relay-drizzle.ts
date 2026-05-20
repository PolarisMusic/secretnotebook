import { and, desc, eq, gt, lt, lte, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { relayInbox } from '../db/schema.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import type {
  EnvelopeListOptions,
  EnvelopeListResult,
  NewEnvelopeInput,
  RelayStore,
  StoredEnvelope,
} from './types.js';

function rowToStored(row: typeof relayInbox.$inferSelect): StoredEnvelope {
  return {
    id: row.id,
    blindedId: row.blindedId,
    header: row.header,
    ciphertext: row.ciphertext,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    expiresAt: row.expiresAt,
  };
}

export class DrizzleRelayStore implements RelayStore {
  constructor(private readonly db: Database) {}

  async insert(input: NewEnvelopeInput): Promise<StoredEnvelope> {
    const [row] = await this.db
      .insert(relayInbox)
      .values({
        id: input.id,
        blindedId: input.blindedId,
        header: input.header,
        ciphertext: input.ciphertext,
        sentAt: input.sentAt,
        receivedAt: input.receivedAt,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error('relay insert returned no row');
    return rowToStored(row);
  }

  async list(opts: EnvelopeListOptions): Promise<EnvelopeListResult> {
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const cursorDate = decoded ? new Date(decoded.createdAt) : null;
    const cursorId = decoded?.id ?? null;

    // Newest-first within a blinded_id bucket, like the posts feed.
    // `>` against expires_at filters out expired rows (TTL is enforced
    // at read time even if the GC sweep hasn't run yet).
    const baseWhere = and(
      eq(relayInbox.blindedId, opts.blindedId),
      gt(relayInbox.expiresAt, opts.now),
    );
    const where =
      cursorDate && cursorId
        ? and(
            baseWhere,
            or(
              lt(relayInbox.receivedAt, cursorDate),
              and(eq(relayInbox.receivedAt, cursorDate), lt(relayInbox.id, cursorId)),
            ),
          )
        : baseWhere;

    const rows = await this.db
      .select()
      .from(relayInbox)
      .where(where)
      .orderBy(desc(relayInbox.receivedAt), desc(relayInbox.id))
      .limit(opts.limit + 1);

    const items = rows.slice(0, opts.limit).map(rowToStored);
    const overflow = rows.length > opts.limit;
    const last = items[items.length - 1];
    const nextCursor =
      overflow && last
        ? encodeCursor({ createdAt: last.receivedAt.toISOString(), id: last.id })
        : null;
    return { items, nextCursor };
  }

  async remove(blindedId: Uint8Array, envelopeId: string): Promise<boolean> {
    const result = await this.db
      .delete(relayInbox)
      .where(and(eq(relayInbox.blindedId, blindedId), eq(relayInbox.id, envelopeId)))
      .returning({ id: relayInbox.id });
    return result.length > 0;
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.db
      .delete(relayInbox)
      .where(lte(relayInbox.expiresAt, now))
      .returning({ id: relayInbox.id });
    return result.length;
  }
}
