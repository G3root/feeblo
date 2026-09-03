import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
import {
  and,
  count,
  eq,
  ilike,
  inArray,
  not,
  useLiveQuery,
} from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import type {
  BoardPostStatusFilter,
  BoardStatusOperator,
  BoardTagOperator,
} from "../../state/board-store-context";
import type { BoardPostRow } from "./types";

const STATUSES_BY_PRESET = {
  active: ["PLANNED", "IN_PROGRESS"],
  backlog: ["PENDING", "REVIEW"],
} satisfies Record<Exclude<BoardPostStatusFilter, "all">, BoardPostStatus[]>;

function filterPostStatusesByPreset(
  statuses: ReadonlyArray<{
    id: string;
    type: BoardPostStatus;
    label: string;
  }>,
  filter: BoardPostStatusFilter
) {
  if (filter === "all") {
    return statuses.slice();
  }
  const allowed = new Set<BoardPostStatus>(STATUSES_BY_PRESET[filter]);
  return statuses.filter((s) => allowed.has(s.type));
}

type UseBoardPostsDataOptions = {
  boardId?: string;
  organizationId: string;
  postStatusFilter: BoardPostStatusFilter;
  search: string;
  statusOperator: BoardStatusOperator;
  statuses: BoardPostStatus[];
  tagIds: string[];
  tagOperator: BoardTagOperator;
};

function useBoardPostStatuses(organizationId: string) {
  const { postStatusCollection } = useDashboardCollections();
  return useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        )
        .select(({ postStatus }) => ({
          id: postStatus.id,
          type: postStatus.type,
          label: postStatus.label,
        }));
    },
    [organizationId]
  );
}

function useBoardList(organizationId: string) {
  const { boardCollection } = useDashboardCollections();
  return useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId))
        .select(({ board }) => ({
          id: board.id,
          name: board.name,
          slug: board.slug,
        }));
    },
    [organizationId]
  );
}

function useMatchingTagPostIds(
  organizationId: string,
  tagIds: string[],
  tagIdsKey: string,
  tagOperator: BoardTagOperator
) {
  const { postTagCollection } = useDashboardCollections();
  const query = useLiveQuery(
    (q) => {
      if (!(organizationId && tagIds.length > 0)) {
        return undefined;
      }

      const baseQuery = q
        .from({ postTag: postTagCollection })
        .where(({ postTag }) =>
          and(
            eq(postTag.organizationId, organizationId),
            inArray(postTag.tagId, tagIds)
          )
        );

      if (tagOperator === "includeAllOf" || tagOperator === "excludeIfAllOf") {
        return baseQuery
          .groupBy(({ postTag }) => postTag.postId)
          .select(({ postTag }) => ({
            matchedCount: count(postTag.postId),
            postId: postTag.postId,
          }))
          .having(({ $selected }) => eq($selected.matchedCount, tagIds.length));
      }

      return baseQuery
        .select(({ postTag }) => ({
          postId: postTag.postId,
        }))
        .distinct();
    },
    [organizationId, tagIdsKey, tagOperator]
  );

  const ids = query.data?.map((entry) => entry.postId) ?? [];
  return { ids, idsKey: ids.join(","), query };
}

type FilteredBoardPostsArgs = {
  boardId?: string;
  organizationId: string;
  postStatusFilter: BoardPostStatusFilter;
  normalizedSearch: string;
  statuses: BoardPostStatus[];
  statusesKey: string;
  statusOperator: BoardStatusOperator;
  tagIds: string[];
  tagIdsKey: string;
  tagOperator: BoardTagOperator;
  matchingTagPostIds: string[];
  matchingTagPostIdsKey: string;
};

function useFilteredBoardPosts({
  boardId,
  organizationId,
  postStatusFilter,
  normalizedSearch,
  statuses,
  statusesKey,
  statusOperator,
  tagIds,
  tagIdsKey,
  tagOperator,
  matchingTagPostIds,
  matchingTagPostIdsKey,
}: FilteredBoardPostsArgs) {
  const { postCollection, postStatusCollection } = useDashboardCollections();
  return useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ post: postCollection })
        .join(
          { postStatus: postStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
        .select(({ post, postStatus }) => ({
          archivedAt: post.archivedAt,
          boardId: post.boardId,
          id: post.id,
          mergedIntoPostId: post.mergedIntoPostId,
          slug: post.slug,
          statusId: post.statusId,
          status: postStatus.type,
          summary: post.excerpt,
          title: post.title,
          updatedAt: post.updatedAt,
          user: post.user,
        }))
        .where(({ post, postStatus }) => {
          let condition = eq(post.organizationId, organizationId);

          if (boardId) {
            condition = and(condition, eq(post.boardId, boardId));
          }

          if (postStatusFilter === "backlog") {
            condition = and(
              condition,
              inArray(postStatus.type, ["PENDING", "REVIEW"])
            );
          }

          if (postStatusFilter === "active") {
            condition = and(
              condition,
              inArray(postStatus.type, ["PLANNED", "IN_PROGRESS"])
            );
          }

          if (normalizedSearch) {
            condition = and(
              condition,
              ilike(post.title, `%${normalizedSearch}%`)
            );
          }

          if (statuses.length > 0) {
            condition = and(
              condition,
              statusOperator === "isNot"
                ? not(inArray(postStatus.type, statuses))
                : inArray(postStatus.type, statuses)
            );
          }

          if (tagIds.length > 0) {
            condition = and(
              condition,
              tagOperator === "excludeIfAnyOf" ||
                tagOperator === "excludeIfAllOf"
                ? not(inArray(post.id, matchingTagPostIds))
                : inArray(post.id, matchingTagPostIds)
            );
          }

          return condition;
        })
        .orderBy((post) => post.post.createdAt, "desc");
    },
    [
      boardId,
      organizationId,
      postStatusFilter,
      normalizedSearch,
      statusesKey,
      statusOperator,
      tagIdsKey,
      tagOperator,
      matchingTagPostIdsKey,
    ]
  );
}

function usePostUpvoteCounts(organizationId: string) {
  const { upvoteCollection } = useDashboardCollections();
  return useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) => eq(upvote.organizationId, organizationId))
        .select(({ upvote }) => ({ postId: upvote.postId }));
    },
    [organizationId]
  );
}

function buildBoardById(
  boards: ReadonlyArray<{ id: string; name: string; slug: string }>
) {
  return new Map(boards.map((board) => [board.id, board]));
}

function buildUpvoteCountByPostId(
  upvotes: ReadonlyArray<{ postId: string }>
) {
  const counts = new Map<string, number>();
  for (const upvote of upvotes) {
    counts.set(upvote.postId, (counts.get(upvote.postId) ?? 0) + 1);
  }
  return counts;
}

function buildBoardPostRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posts: ReadonlyArray<any>,
  boardById: Map<string, { name: string; slug: string }>,
  upvoteCountByPostId: Map<string, number>
): BoardPostRow[] {
  return posts.map((post) => ({
    ...post,
    boardName: boardById.get(post.boardId)?.name ?? "",
    boardSlug: boardById.get(post.boardId)?.slug ?? "",
    upvoteCount: upvoteCountByPostId.get(post.id) ?? 0,
    user: post.user,
  }));
}

export function useBoardPostsData({
  boardId,
  organizationId,
  postStatusFilter,
  search,
  statusOperator,
  statuses,
  tagIds,
  tagOperator,
}: UseBoardPostsDataOptions) {
  const normalizedSearch = search.trim();
  const statusesKey = statuses.join(",");
  const tagIdsKey = tagIds.join(",");

  const postStatusesQuery = useBoardPostStatuses(organizationId);
  const boardsQuery = useBoardList(organizationId);
  const matchingTags = useMatchingTagPostIds(
    organizationId,
    tagIds,
    tagIdsKey,
    tagOperator
  );
  const postsQuery = useFilteredBoardPosts({
    boardId,
    organizationId,
    postStatusFilter,
    normalizedSearch,
    statuses,
    statusesKey,
    statusOperator,
    tagIds,
    tagIdsKey,
    tagOperator,
    matchingTagPostIds: matchingTags.ids,
    matchingTagPostIdsKey: matchingTags.idsKey,
  });
  const upvotesQuery = usePostUpvoteCounts(organizationId);

  const boardById = buildBoardById(boardsQuery.data ?? []);
  const upvoteCountByPostId = buildUpvoteCountByPostId(upvotesQuery.data ?? []);
  const posts = buildBoardPostRows(
    postsQuery.data ?? [],
    boardById,
    upvoteCountByPostId
  );

  return {
    hasError:
      postStatusesQuery.isError ||
      boardsQuery.isError ||
      matchingTags.query.isError ||
      postsQuery.isError ||
      upvotesQuery.isError,
    isLoading:
      postStatusesQuery.isLoading ||
      boardsQuery.isLoading ||
      postsQuery.isLoading ||
      upvotesQuery.isLoading ||
      (tagIds.length > 0 && matchingTags.query.isLoading),
    postStatuses: filterPostStatusesByPreset(
      postStatusesQuery.data ?? [],
      postStatusFilter
    ),
    posts,
  };
}
