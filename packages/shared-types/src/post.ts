import { z } from 'zod';

export const PostContentType = z.enum(['text', 'link']);
export type PostContentType = z.infer<typeof PostContentType>;

/**
 * Who a post is intended for. The author tags this at publish; the global
 * feed's default-on role filter shows posts whose audience matches the
 * viewer's connection role plus `everyone`. Legacy/untagged posts default
 * to `everyone` so they stay visible to all.
 */
export const PostAudience = z.enum(['everyone', 'masculine', 'feminine']);
export type PostAudience = z.infer<typeof PostAudience>;

/** Why a post was flagged. Each flag carries one category; the feed shows
 *  the distinct categories on a post in place of its (withheld) content. */
export const PostFlagCategory = z.enum(['sexual', 'violent', 'spam', 'other']);
export type PostFlagCategory = z.infer<typeof PostFlagCategory>;

export const PostInputSchema = z.object({
  contentType: PostContentType,
  body: z.string().min(1).max(4000),
  audience: PostAudience.default('everyone'),
});
export type PostInput = z.infer<typeof PostInputSchema>;

export const PostSchema = z.object({
  id: z.string().uuid(),
  contentType: PostContentType,
  // May be '' when the post is obscured by moderation — once a post has any
  // flags the server withholds the body and the client renders `flags`
  // instead. Non-obscured posts always carry the real (non-empty) body.
  body: z.string().max(4000),
  audience: PostAudience,
  anonAuthor: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  /** Distinct moderation-flag categories on this post. Non-empty ⇒ the post
   *  is obscured (body withheld) and these reasons are shown in its place. */
  flags: z.array(PostFlagCategory).default([]),
});
export type Post = z.infer<typeof PostSchema>;

export const PostListResponseSchema = z.object({
  items: z.array(PostSchema),
  nextCursor: z.string().nullable(),
});
export type PostListResponse = z.infer<typeof PostListResponseSchema>;

export const PostListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Role filter: when present, the feed returns posts tagged for this role
   *  plus `everyone`. Omitted = no filter (all posts). */
  audience: z.enum(['masculine', 'feminine']).optional(),
});
export type PostListQuery = z.infer<typeof PostListQuerySchema>;

/** Body of POST /v1/posts/:id/flag — the reason for the report. */
export const PostFlagInputSchema = z.object({
  category: PostFlagCategory,
});
export type PostFlagInput = z.infer<typeof PostFlagInputSchema>;

export const PostFlagResponseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
});
export type PostFlagResponse = z.infer<typeof PostFlagResponseSchema>;
