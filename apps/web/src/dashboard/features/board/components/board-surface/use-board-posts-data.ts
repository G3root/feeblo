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
import { useMemo } from "react";

import {
  boardCollection,
  postCollection,
  postStatusCollection,
  postTagCollection,
  tagCollection,
  upvoteCollection,
} from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import type {
  BoardPostStatusFilter,
  BoardStatusOperator,
  BoardTagOperator,
} from "../../state/board-store-context";
import type { BoardPostRow } from "./types";

/**
 * Warms exactly the collections `useBoardPostsData` subscribes to. Board
 * and feedback routes call this in `beforeLoad` so lane data arrives with
 * the route instead of after mount; the layout only preloads shell-level
 * collections (organization, board, plan).
 */
export async function preloadBoardPostsDataCollections(): Promise<void> {
  await Promise.all([
    boardCollection.preload(),
    postCollection.preload(),
    postStatusCollection.preload(),
    tagCollection.preload(),
    postTagCollection.preload(),
    upvoteCollection.preload(),
  ]);
}

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
  const {
    boardCollection,
    postCollection,
    postStatusCollection,
    postTagCollection,
    upvoteCollection,
  } = useDashboardCollections();
  const normalizedSearch = search.trim();
  const statusesKey = statuses.join(",");
  const tagIdsKey = tagIds.join(",");

  const postStatusesQuery = useLiveQuery(
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

  const boardsQuery = useLiveQuery(
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

  const matchingTagPostsQuery = useLiveQuery(
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

  const matchingTagPostIds =
    matchingTagPostsQuery.data?.map((entry) => entry.postId) ?? [];
  const matchingTagPostIdsKey = matchingTagPostIds.join(",");

  const postsQuery = useLiveQuery(
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

  const upvotesQuery = useLiveQuery(
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

  const boardsData = boardsQuery.data;
  const upvotesData = upvotesQuery.data;
  const postsData = postsQuery.data;
  const postStatusesData = postStatusesQuery.data;

  // Derived maps and rows are rebuilt only when their source query data
  // changes. Without this every render allocates new arrays/objects, which
  // defeats the `memo` on lane/row components below and re-renders the
  // whole board on unrelated store updates (selection, dialogs).
  const posts: BoardPostRow[] = useMemo(() => {
    const boardById = new Map(
      (boardsData ?? []).map((board) => [board.id, board])
    );

    const upvoteCountByPostId = new Map<string, number>();

    for (const upvote of upvotesData ?? []) {
      upvoteCountByPostId.set(
        upvote.postId,
        (upvoteCountByPostId.get(upvote.postId) ?? 0) + 1
      );
    }

    return (postsData ?? []).map((post) => ({
      ...post,
      boardName: boardById.get(post.boardId)?.name ?? "",
      boardSlug: boardById.get(post.boardId)?.slug ?? "",
      upvoteCount: upvoteCountByPostId.get(post.id) ?? 0,
      user: post.user,
    }));
  }, [boardsData, upvotesData, postsData]);

  const postStatuses = useMemo(
    () => filterPostStatusesByPreset(postStatusesData ?? [], postStatusFilter),
    [postStatusesData, postStatusFilter]
  );

  return {
    hasError:
      postStatusesQuery.isError ||
      boardsQuery.isError ||
      matchingTagPostsQuery.isError ||
      postsQuery.isError ||
      upvotesQuery.isError,
    isLoading:
      postStatusesQuery.isLoading ||
      boardsQuery.isLoading ||
      postsQuery.isLoading ||
      upvotesQuery.isLoading ||
      (tagIds.length > 0 && matchingTagPostsQuery.isLoading),
    postStatuses,
    posts,
  };
}
