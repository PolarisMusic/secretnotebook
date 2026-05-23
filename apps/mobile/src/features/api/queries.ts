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
  PostInput,
  PostListResponse,
} from '@secretnotebook/shared-types';
import type { SqlExecutor } from '../../db/executor';
import { cachePost, cachePosts } from './cache';
import type { ApiClient } from './client';

export const postsKeys = {
  all: ['posts'] as const,
  list: (limit: number) => ['posts', 'list', limit] as const,
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
}): UseInfiniteQueryResult<InfiniteData<PostListResponse>, Error> {
  const pageSize = args.pageSize ?? 20;
  return useInfiniteQuery<
    PostListResponse,
    Error,
    InfiniteData<PostListResponse>,
    ReadonlyArray<unknown>,
    string | undefined
  >({
    queryKey: postsKeys.list(pageSize),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const page = await args.client.listPosts({
        cursor: pageParam,
        limit: pageSize,
      });
      if (args.exec && page.items.length > 0) {
        await cachePosts(args.exec, page.items);
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

export function useRegisterDevice(args: {
  client: ApiClient;
}): UseMutationResult<DeviceRegisterResponse, Error, void> {
  return useMutation<DeviceRegisterResponse, Error, void>({
    mutationFn: async () => args.client.registerDevice(),
  });
}
