import type { Collection, UtilsRecord } from "@tanstack/db";
import { and, count, eq, inArray, useLiveQuery } from "@tanstack/react-db";

type BoardRowLike = {
  id: string;
  name: string;
  organizationId: string;
  slug: string;
};

type PostRowLike = {
  boardId: string;
  createdAt: Date | string;
  id: string;
  organizationId: string;
  slug: string;
  statusId: string;
  title: string;
};

type PostStatusRowLike = {
  id: string;
  organizationId: string;
  type: string;
};

type UpvoteRowLike = {
  id: string;
  organizationId: string;
  postId: string;
};

export type DashboardHomeStatsCollections<
  TBoard extends BoardRowLike = BoardRowLike,
  TPost extends PostRowLike = PostRowLike,
  TPostStatus extends PostStatusRowLike = PostStatusRowLike,
  TUpvote extends UpvoteRowLike = UpvoteRowLike,
> = {
  boardCollection: Collection<TBoard, string, UtilsRecord>;
  postCollection: Collection<TPost, string, UtilsRecord>;
  postStatusCollection: Collection<TPostStatus, string, UtilsRecord>;
  upvoteCollection: Collection<TUpvote, string, UtilsRecord>;
};

export type UseDashboardHomeStatsOptions<
  TBoard extends BoardRowLike = BoardRowLike,
  TPost extends PostRowLike = PostRowLike,
  TPostStatus extends PostStatusRowLike = PostStatusRowLike,
  TUpvote extends UpvoteRowLike = UpvoteRowLike,
> = DashboardHomeStatsCollections<TBoard, TPost, TPostStatus, TUpvote> & {
  organizationId: string | undefined;
};

export type UseDashboardHomeStatsResult<
  TBoard extends BoardRowLike = BoardRowLike,
  TPost extends PostRowLike = PostRowLike,
  TPostStatus extends PostStatusRowLike = PostStatusRowLike,
> = {
  boards: TBoard[];
  statuses: TPostStatus[];
  recentPosts: TPost[];
  upvoteCounts: Array<{ count: number; postId: string }>;
  isError: boolean;
  isLoading: boolean;
};

export function useDashboardHomeStats<
  TBoard extends BoardRowLike = BoardRowLike,
  TPost extends PostRowLike = PostRowLike,
  TPostStatus extends PostStatusRowLike = PostStatusRowLike,
  TUpvote extends UpvoteRowLike = UpvoteRowLike,
>({
  boardCollection,
  postCollection,
  postStatusCollection,
  upvoteCollection,
  organizationId,
}: UseDashboardHomeStatsOptions<
  TBoard,
  TPost,
  TPostStatus,
  TUpvote
>): UseDashboardHomeStatsResult<TBoard, TPost, TPostStatus> {
  const boardsQuery = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId));
    },
    [organizationId]
  );

  const statusesQuery = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        );
    },
    [organizationId]
  );

  const recentPostsQuery = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ post: postCollection })
        .where(({ post }) => eq(post.organizationId, organizationId))
        .orderBy(({ post }) => post.createdAt, "desc")
        .limit(5);
    },
    [organizationId]
  );

  const recentPostIds = (recentPostsQuery.data ?? []).map((post) => post.id);
  const recentPostIdsKey = recentPostIds.join(",");

  const upvoteCountsQuery = useLiveQuery(
    (q) => {
      if (!organizationId || recentPostIds.length === 0) {
        return undefined;
      }

      return q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            inArray(upvote.postId, recentPostIds)
          )
        )
        .groupBy(({ upvote }) => upvote.postId)
        .select(({ upvote }) => ({
          count: count(upvote.id),
          postId: upvote.postId,
        }));
    },
    [organizationId, recentPostIdsKey]
  );

  const isError =
    boardsQuery.isError ||
    statusesQuery.isError ||
    recentPostsQuery.isError ||
    upvoteCountsQuery.isError;
  const isLoading =
    boardsQuery.isLoading ||
    statusesQuery.isLoading ||
    recentPostsQuery.isLoading ||
    upvoteCountsQuery.isLoading;

  return {
    boards: boardsQuery.data ?? [],
    statuses: statusesQuery.data ?? [],
    recentPosts: recentPostsQuery.data ?? [],
    upvoteCounts: upvoteCountsQuery.data ?? [],
    isError,
    isLoading,
  };
}
