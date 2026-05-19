import { z } from 'zod';

export const PostContentType = z.enum(['text', 'link']);
export type PostContentType = z.infer<typeof PostContentType>;

export const PostInputSchema = z.object({
  contentType: PostContentType,
  body: z.string().min(1).max(4000),
});
export type PostInput = z.infer<typeof PostInputSchema>;

export const PostSchema = z.object({
  id: z.string().uuid(),
  contentType: PostContentType,
  body: z.string().min(1).max(4000),
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
});
export type PostListQuery = z.infer<typeof PostListQuerySchema>;
