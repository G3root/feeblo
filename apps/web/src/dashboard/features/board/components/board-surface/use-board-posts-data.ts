import {
  and,
  count,
  eq,
  inArray,
  not,
  or,
  useLiveQuery,
} from "@tanstack/react-db";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
  postTagCollection,
} from "~/lib/collections";
import type { BoardPostStatus } from "../../constants";
import type {
  BoardPostStatusFilter,
  BoardStatusOperator,
  BoardTagOperator,
} from "../../state/board-store-context";
import type { BoardPostRow } from "./types";

type UseBoardPostsDataOptions = {
  boardId?: string;
  organizationId: string;
  postStatusFilter: BoardPostStatusFilter;
  statusOperator: BoardStatusOperator;
  statuses: BoardPostStatus[];
  tagIds: string[];
  tagOperator: BoardTagOperator;
};

export function useBoardPostsData({
  boardId,
  organizationId,
  postStatusFilter,
  statusOperator,
  statuses,
  tagIds,
  tagOperator,
}: UseBoardPostsDataOptions) {
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
          boardId: post.boardId,
          id: post.id,
          slug: post.slug,
          statusId: post.statusId,
          status: postStatus.type,
          summary: post.content,
          title: post.title,
          updatedAt: post.updatedAt,
        }))
        .where(({ post, postStatus }) => {
          let condition = eq(post.organizationId, organizationId);

          if (boardId) {
            condition = and(condition, eq(post.boardId, boardId));
          }

          if (postStatusFilter === "backlog") {
            condition = and(
              condition,
              or(eq(postStatus.type, "PENDING"), eq(postStatus.type, "REVIEW"))
            );
          }

          if (postStatusFilter === "active") {
            condition = and(
              condition,
              or(
                eq(postStatus.type, "PLANNED"),
                eq(postStatus.type, "IN_PROGRESS")
              )
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
      statusesKey,
      statusOperator,
      tagIdsKey,
      tagOperator,
      matchingTagPostIdsKey,
    ]
  );

  const boardById = new Map(
    (boardsQuery.data ?? []).map((board) => [board.id, board])
  );

  const posts: BoardPostRow[] = (postsQuery.data ?? []).map((post) => ({
    ...post,
    boardName: boardById.get(post.boardId)?.name ?? "",
    boardSlug: boardById.get(post.boardId)?.slug ?? "",
  }));

  return {
    hasError:
      postStatusesQuery.isError ||
      boardsQuery.isError ||
      matchingTagPostsQuery.isError ||
      postsQuery.isError,
    isLoading:
      postStatusesQuery.isLoading ||
      boardsQuery.isLoading ||
      postsQuery.isLoading ||
      (tagIds.length > 0 && matchingTagPostsQuery.isLoading),
    postStatuses: postStatusesQuery.data ?? [],
    posts,
  };
}
