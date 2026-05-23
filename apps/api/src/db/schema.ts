import { customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    if (Buffer.isBuffer(value)) return new Uint8Array(value);
    if (value instanceof Uint8Array) return value;
    throw new Error('bytea: unexpected driver value');
  },
});

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey(),
  contentType: text('content_type').notNull(),
  body: text('body').notNull(),
  bodyHash: bytea('body_hash').notNull(),
  anonAuthor: bytea('anon_author').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  popularity: integer('popularity').notNull().default(0),
});

export const devices = pgTable('devices', {
  pubkey: bytea('pubkey').primaryKey(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  reputation: integer('reputation').notNull().default(0),
});

export const relayInbox = pgTable('relay_inbox', {
  id: uuid('id').primaryKey(),
  blindedId: bytea('blinded_id').notNull(),
  header: bytea('header').notNull(),
  ciphertext: bytea('ciphertext').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type RelayInboxRow = typeof relayInbox.$inferSelect;
export type NewRelayInboxRow = typeof relayInbox.$inferInsert;
