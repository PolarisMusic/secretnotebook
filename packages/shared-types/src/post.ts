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

export const PostInputSchema = z.object({
  contentType: PostContentType,
  body: z.string().min(1).max(4000),
  audience: PostAudience.default('everyone'),
});
export type PostInput = z.infer<typeof PostInputSchema>;

export const PostSchema = z.object({
  id: z.string().uuid(),
  contentType: PostContentType,
  body: z.string().min(1).max(4000),
  audience: PostAudience,
  anonAuthor: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
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
