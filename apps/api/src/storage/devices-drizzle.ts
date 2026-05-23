import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { devices } from '../db/schema.js';
import type { DevicesStore } from './types.js';

export class DrizzleDevicesStore implements DevicesStore {
  constructor(private readonly db: Database) {}

  async register(pubkey: Uint8Array, now: Date): Promise<void> {
    await this.db
      .insert(devices)
      .values({ pubkey, firstSeen: now })
      .onConflictDoNothing({ target: devices.pubkey });
  }

  async exists(pubkey: Uint8Array): Promise<boolean> {
    const rows = await this.db
      .select({ exists: sql<number>`1` })
      .from(devices)
      .where(eq(devices.pubkey, pubkey))
      .limit(1);
    return rows.length > 0;
  }
}
