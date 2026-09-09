import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
import {
  and,
  coalesce,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  isUndefined,
  not,
  or,
  useLiveQuery,
} from "@tanstack/react-db";
import { useDeferredValue, useMemo } from "react";

import {
  boardCollection,
  deleteEligibilityCollection,
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
 *
 * TanStack DB is deliberately overfetched here: full org collections sync
 * once, then every filter/search/sort runs as an incremental live query
 * (D2 differential dataflow) with no further network trips. Keep it that
 * way — do not "optimize" this into paginated server queries without
 * replacing the whole board data model.
 */
export async function preloadBoardPostsDataCollections(): Promise<void> {
  await Promise.all([
    boardCollection.preload(),
    deleteEligibilityCollection.preload(),
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
  // Defer the title filter off the urgent keystroke path (same pattern as
  // the public board): the input stays responsive while the live query
  // re-runs over the overfetched collection at lower priority.
  const deferredSearch = useDeferredValue(normalizedSearch);
  const statusesKey = statuses.join(",");
  const tagIdsKey = tagIds.join(",");

  const postStatusesQuery = useBoardPostStatuses(organizationId);

  // One live query for everything the lanes render. The previous shape ran
  // five separate queries and stitched them in JS (board Map, upvote-count
  // Map, tag id-list bridged through a comma-joined dep key): every vote
  // recounted all org upvotes from scratch and every tag change rebuilt an
  // O(n) key that re-subscribed the posts query. Here D2 maintains each
  // piece incrementally —
  // - board name/slug resolve in a left join (a post never vanishes when
  //   its board row arrives late),
  // - upvote totals come from a groupBy subquery (one small row per post
  //   instead of every upvote row materialized),
  // - tag matching is a grouped subquery joined in place, so there is no
  //   JS id-list bridge and no giant dep key.
  const postsQuery = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      const upvoteCounts = q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) => eq(upvote.organizationId, organizationId))
        .groupBy(({ upvote }) => upvote.postId)
        .select(({ upvote }) => ({
          postId: upvote.postId,
          upvoteCount: count(upvote.id),
        }));

      // Grouped per post so every tag operator shares one subquery shape:
      // the `having` keeps only full matches for *AllOf modes (a tautology
      // otherwise) and the join kind in `where` picks include vs exclude.
      // `in` over an empty tag list matches nothing, so with no tags
      // selected this join is an inert no-op rather than a branch.
      const requireAllTags =
        tagOperator === "includeAllOf" || tagOperator === "excludeIfAllOf";
      const matchingTags = q
        .from({ postTag: postTagCollection })
        .where(({ postTag }) =>
          and(
            eq(postTag.organizationId, organizationId),
            inArray(postTag.tagId, tagIds)
          )
        )
        .groupBy(({ postTag }) => postTag.postId)
        .select(({ postTag }) => ({
          matchedCount: count(postTag.postId),
          postId: postTag.postId,
        }))
        .having(({ $selected }) =>
          requireAllTags
            ? eq($selected.matchedCount, tagIds.length)
            : gte($selected.matchedCount, 1)
        );

      return q
        .from({ post: postCollection })
        .join(
          { postStatus: postStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
        .leftJoin({ board: boardCollection }, ({ post, board }) =>
          eq(post.boardId, board.id)
        )
        .leftJoin({ upvoteCounts }, ({ post, upvoteCounts }) =>
          eq(post.id, upvoteCounts.postId)
        )
        .leftJoin({ matchingTags }, ({ post, matchingTags }) =>
          eq(post.id, matchingTags.postId)
        )
        .where(({ matchingTags, post, postStatus }) => {
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

          if (deferredSearch) {
            condition = and(
              condition,
              ilike(post.title, `%${deferredSearch}%`)
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
            // A missed left join reads as null/undefined (same guard as the
            // changelog completed-posts query).
            const unmatched = or(
              isNull(matchingTags.postId),
              isUndefined(matchingTags.postId)
            );
            if (
              tagOperator === "excludeIfAnyOf" ||
              tagOperator === "excludeIfAllOf"
            ) {
              if (tagOperator === "excludeIfAllOf") {
                condition = and(
                  condition,
                  or(
                    unmatched,
                    not(eq(matchingTags.matchedCount, tagIds.length))
                  )
                );
              } else {
                condition = and(condition, unmatched);
              }
            } else {
              condition = and(condition, not(unmatched));
            }
          }

          return condition;
        })
        .orderBy(({ post }) => post.createdAt, "desc")
        .select(({ board, post, postStatus, upvoteCounts }) => ({
          archivedAt: post.archivedAt,
          boardId: post.boardId,
          boardName: coalesce(board.name, ""),
          boardSlug: coalesce(board.slug, ""),
          id: post.id,
          mergedIntoPostId: post.mergedIntoPostId,
          slug: post.slug,
          statusId: post.statusId,
          status: postStatus.type,
          summary: post.excerpt,
          title: post.title,
          updatedAt: post.updatedAt,
          upvoteCount: coalesce(upvoteCounts.upvoteCount, 0),
          user: post.user,
        }));
    },
    [
      boardId,
      organizationId,
      postStatusFilter,
      deferredSearch,
      statusesKey,
      statusOperator,
      tagIdsKey,
      tagOperator,
    ]
  );

  const posts: BoardPostRow[] = postsQuery.data ?? [];

  const postStatuses = useMemo(
    () =>
      filterPostStatusesByPreset(
        postStatusesQuery.data ?? [],
        postStatusFilter
      ),
    [postStatusesQuery.data, postStatusFilter]
  );

  return {
    hasError: postStatusesQuery.isError || postsQuery.isError,
    isLoading: postStatusesQuery.isLoading || postsQuery.isLoading,
    postStatuses,
    posts,
  };
}
