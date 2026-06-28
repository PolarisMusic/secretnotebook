import {
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

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
  // Author-tagged intended audience ('everyone' | 'masculine' | 'feminine').
  // Drives the feed's role filter; defaults to 'everyone' for legacy rows.
  audience: text('audience').notNull().default('everyone'),
});

export const postFlags = pgTable(
  'post_flag',
  {
    id: uuid('id').primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    /** Free-text reason. Required when category='other' (enforced by the
     *  shared schema, not the table); optional otherwise. */
    detail: text('detail'),
    flaggedBy: bytea('flagged_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One report per (post, device); re-flagging is idempotent.
    uniqByDevice: unique('post_flag_post_device_uniq').on(t.postId, t.flaggedBy),
  }),
);

/**
 * Append-only moderation audit. Each row is one report against the
 * strictest flag category (`reveals_personal_details`). Distinct from
 * `post_flag` because:
 *   - post_flag dedupes (post, device) so re-flagging is idempotent;
 *     the audit needs every report preserved
 *   - the audit row carries the ORIGINAL POSTER's anon-pubkey so a
 *     moderator can review the offending author without joining back
 *     to posts (which might be deleted by then)
 * No FK to posts.id — a deleted post must not silently wipe its audit
 * trail.
 */
export const flagLog = pgTable('flag_log', {
  id: uuid('id').primaryKey(),
  postId: uuid('post_id').notNull(),
  /** anon_author of the post that was reported. */
  postedBy: bytea('posted_by').notNull(),
  /** pubkey of the device that filed the report. */
  flagger: bytea('flagger').notNull(),
  category: text('category').notNull(),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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

/**
 * Relationship-prompt library, now server-owned. Mobile clients fetch
 * the active set on boot + cache locally; the bundled hardcoded list
 * survives as an offline-first seed.
 *
 * `key` is the stable identifier mobile ops carry. Once a key has
 * shipped in a `secret_unlock.start` op it MUST keep resolving — retire
 * by setting `retired_at`, never by deleting.
 *
 * `categories` holds a JSON array of category strings (the taxonomy
 * lives in the mobile package). Source attribution + sponsorship are
 * inline so the admin can flip them per row.
 */
export const prompts = pgTable('prompt', {
  key: text('key').primaryKey(),
  text: text('text').notNull(),
  categories: jsonb('categories').notNull().$type<string[]>().default([]),
  sourceName: text('source_name'),
  sourceUrl: text('source_url'),
  sponsored: boolean('sponsored').notNull().default(false),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const blobs = pgTable('blobs', {
  id: uuid('id').primaryKey(),
  // Opaque ciphertext (chunked-AEAD framed); the server never decrypts it.
  data: bytea('data').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type PostFlag = typeof postFlags.$inferSelect;
export type NewPostFlag = typeof postFlags.$inferInsert;
export type FlagLogRow = typeof flagLog.$inferSelect;
export type NewFlagLogRow = typeof flagLog.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type RelayInboxRow = typeof relayInbox.$inferSelect;
export type NewRelayInboxRow = typeof relayInbox.$inferInsert;
export type BlobRow = typeof blobs.$inferSelect;
export type NewBlobRow = typeof blobs.$inferInsert;
export type PromptRow = typeof prompts.$inferSelect;
export type NewPromptRow = typeof prompts.$inferInsert;
