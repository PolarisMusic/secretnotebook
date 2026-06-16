import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  DeviceRegisterResponse,
  Post,
  PostFlagCategory,
  PostFlagResponse,
  PostInput,
  PostListResponse,
} from '@secretnotebook/shared-types';
import type { SqlExecutor } from '../../db/executor';
import { cachePost, cachePosts, filterHiddenPosts, hidePost } from './cache';
import type { ApiClient } from './client';

export const postsKeys = {
  all: ['posts'] as const,
  list: (limit: number, audience?: 'masculine' | 'feminine') =>
    ['posts', 'list', limit, audience ?? 'all'] as const,
  detail: (id: string) => ['posts', 'detail', id] as const,
};

/**
 * Infinite-scroll hook for the global feed. Pulls one page from the server
 * per `fetchNextPage()` call, write-throughs each fetched page into the
 * SQLCipher `post_cache` table, and exposes the flattened list via
 * `data.pages.flatMap(p => p.items)`.
 *
 * The optional executor is the production write-through path; tests can
 * leave it undefined to bypass DB work.
 */
export function usePostsFeed(args: {
  client: ApiClient;
  exec?: SqlExecutor | null;
  pageSize?: number;
  /** Role filter; when set, the feed shows this role's posts plus 'everyone'. */
  audience?: 'masculine' | 'feminine';
}): UseInfiniteQueryResult<InfiniteData<PostListResponse>, Error> {
  const pageSize = args.pageSize ?? 20;
  return useInfiniteQuery<
    PostListResponse,
    Error,
    InfiniteData<PostListResponse>,
    ReadonlyArray<unknown>,
    string | undefined
  >({
    queryKey: postsKeys.list(pageSize, args.audience),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const page = await args.client.listPosts({
        cursor: pageParam,
        limit: pageSize,
        audience: args.audience,
      });
      if (args.exec) {
        if (page.items.length > 0) await cachePosts(args.exec, page.items);
        // Drop this device's locally-hidden posts from the rendered page;
        // they're still cached above so an un-hide could restore them.
        const items = await filterHiddenPosts(args.exec, page.items);
        return { items, nextCursor: page.nextCursor };
      }
      return page;
    },
  });
}

/**
 * Single-post detail query. Falls back to the cache only after a network
 * failure — the live feed is the source of truth while we're online, and
 * S7 unlock flows expect a fresh read on first view.
 */
export function usePostDetail(args: {
  client: ApiClient;
  id: string;
  exec?: SqlExecutor | null;
  enabled?: boolean;
}): UseQueryResult<Post, Error> {
  return useQuery<Post, Error>({
    queryKey: postsKeys.detail(args.id),
    enabled: args.enabled ?? true,
    queryFn: async () => {
      const post = await args.client.getPost(args.id);
      if (args.exec) await cachePost(args.exec, post);
      return post;
    },
  });
}

export interface SubmitPostResult {
  id: string;
  createdAt: string;
}

export function useSubmitPost(args: {
  client: ApiClient;
  queryClient?: QueryClient;
}): UseMutationResult<SubmitPostResult, Error, PostInput> {
  const ctxQc = useQueryClient();
  const qc = args.queryClient ?? ctxQc;
  return useMutation<SubmitPostResult, Error, PostInput>({
    mutationFn: async (input) => args.client.submitPost(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: postsKeys.all });
    },
  });
}

/** Flag a post for moderation (global, server-side). Invalidates the feed
 *  so the now-obscured post re-renders with its reason. */
export function useFlagPost(args: {
  client: ApiClient;
  queryClient?: QueryClient;
}): UseMutationResult<PostFlagResponse, Error, { id: string; category: PostFlagCategory }> {
  const ctxQc = useQueryClient();
  const qc = args.queryClient ?? ctxQc;
  return useMutation<PostFlagResponse, Error, { id: string; category: PostFlagCategory }>({
    mutationFn: async ({ id, category }) => args.client.flagPost(id, category),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: postsKeys.all });
    },
  });
}

/** Hide a post locally (personal). Invalidates the feed so it drops out. */
export function useHidePost(args: {
  exec: SqlExecutor | null;
  queryClient?: QueryClient;
}): UseMutationResult<void, Error, string> {
  const ctxQc = useQueryClient();
  const qc = args.queryClient ?? ctxQc;
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      if (args.exec) await hidePost(args.exec, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: postsKeys.all });
    },
  });
}

export function useRegisterDevice(args: {
  client: ApiClient;
}): UseMutationResult<DeviceRegisterResponse, Error, void> {
  return useMutation<DeviceRegisterResponse, Error, void>({
    mutationFn: async () => args.client.registerDevice(),
  });
}
