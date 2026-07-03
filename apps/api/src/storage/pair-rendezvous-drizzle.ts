import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { pairRendezvous } from '../db/schema.js';
import type { PairRendezvousStore, StoredHello } from './types.js';

export class DrizzlePairRendezvousStore implements PairRendezvousStore {
  constructor(private readonly db: Database) {}

  async listHellos(code: string, now: Date): Promise<StoredHello[]> {
    const rows = await this.db
      .select({ hello: pairRendezvous.hello, postedAt: pairRendezvous.postedAt })
      .from(pairRendezvous)
      .where(and(eq(pairRendezvous.code, code), gt(pairRendezvous.expiresAt, now)))
      .orderBy(asc(pairRendezvous.postedAt));
    return rows.map((r) => ({ hello: r.hello, postedAt: r.postedAt }));
  }

  async insertHello(code: string, hello: string, postedAt: Date, expiresAt: Date): Promise<void> {
    // Idempotent on (code, hello): a repeat post from the same device is a
    // no-op rather than an error, matching the old in-memory behaviour.
    await this.db
      .insert(pairRendezvous)
      .values({ code, hello, postedAt, expiresAt })
      .onConflictDoNothing();
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.db
      .delete(pairRendezvous)
      .where(lte(pairRendezvous.expiresAt, now))
      .returning({ code: pairRendezvous.code });
    return result.length;
  }
}
