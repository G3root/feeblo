import type {
  TBoardQuery,
  TBoardStatusFilter,
} from "@feeblo/domain-contracts/board-query";
import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
import { isLiveQueryFailed } from "@feeblo/web-shared/collections";
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

import { useOrgPostStatuses } from "~/hooks/use-org-post-statuses";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import type { MyFeedbackScope } from "../../lib/my-feedback-views";
import type { BoardPostRow } from "./types";

type UseBoardPostsDataOptions = {
  boardId?: string;
  /**
   * The member's own feedback page. Applied as a predicate here rather than as
   * one of `BoardFilters` because it is the page, not a filter: the filter menu
   * cannot clear it and no saved view can store it.
   */
  myFeedbackScope?: MyFeedbackScope;
  organizationId: string;
  /**
   * The saved-view document, as the store holds it.
   *
   * The whole query is the live query's input: filters, ordering and version
   * are one value, so the hook does not restate the filter vocabulary in its
   * parameter list and the `queryKey` does not list each filter field
   * separately. A filter added to `BoardFilters` reaches this query through the
   * shared struct rather than through a new prop somebody has to remember to
   * thread.
   */
  query: TBoardQuery;
};

/**
 * The status lanes to render, in the order the workspace defines.
 *
 * The lanes follow the status filter: "is any of" keeps the selected types,
 * "is not" removes them, and no filter keeps every status. That is the same
 * rule the posts predicate applies, so a lane can never name a status the
 * result set excludes, and a post can never land in an unnamed lane because
 * its status was filtered out of the lane list.
 */
function visiblePostStatuses(
  postStatuses: ReadonlyArray<{
    id: string;
    type: BoardPostStatus;
    label: string;
  }>,
  filter: TBoardStatusFilter | null
) {
  if (filter === null) {
    return postStatuses.slice();
  }

  const selected = new Set<BoardPostStatus>(filter.types);

  return filter.operator === "isNot"
    ? postStatuses.filter((status) => !selected.has(status.type))
    : postStatuses.filter((status) => selected.has(status.type));
}

export function useBoardPostsData({
  boardId,
  myFeedbackScope,
  organizationId,
  query,
}: UseBoardPostsDataOptions) {
  const {
    boardCollection,
    postCollection,
    postStatusCollection,
    postTagCollection,
    upvoteCollection,
  } = useDashboardCollections();
  const { filters, ordering } = query;
  const statusFilter = filters.status;
  const tagFilter = filters.tag;
  const assigneeMemberIds = filters.assigneeMemberIds ?? [];
  const tagIds = tagFilter?.tagIds ?? [];
  const tagOperator = tagFilter?.operator;
  // The persisted document stores a trimmed term; this trims again so a raw
  // store value (the input updates before the view is saved) still hashes and
  // matches as the word the member is typing rather than its trailing space.
  const deferredSearch = useDeferredValue((filters.search ?? "").trim());

  // The live query reads the deferred term, so the key names what the query
  // actually executes. `version` is folded into the key because a future
  // version may change how a filter is read even when its fields are equal.
  const queryKeyFilters = useMemo(
    () => ({
      ...filters,
      search: deferredSearch === "" ? null : deferredSearch,
    }),
    [deferredSearch, filters]
  );

  const postStatusesQuery = useOrgPostStatuses(organizationId);

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
  const postsQuery = useLiveQuery({
    // The board surface's main query: the largest IR in the dashboard and the
    // board re-renders on every keystroke/filter change. The key is the
    // persisted document rather than one entry per filter field, so a filter
    // added to `BoardFilters` cannot be forgotten here and leave the query
    // answering an older shape.
    queryKey: [
      "board-posts",
      postCollection.id,
      postStatusCollection.id,
      boardCollection.id,
      upvoteCollection.id,
      postTagCollection.id,
      organizationId,
      boardId ?? null,
      myFeedbackScope ?? null,
      query.version,
      queryKeyFilters,
      ordering,
    ],
    query: (q) => {
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
            inArray(postTag.tagId, [...tagIds])
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

      const filteredQuery = q
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

          // Merged posts are hidden from the board entirely; they stay
          // reachable through the survivor's merged-posts list (dashboard
          // only) so the duplicate never competes as a card.
          condition = and(condition, isNull(post.mergedIntoPostId));

          if (boardId) {
            condition = and(condition, eq(post.boardId, boardId));
          }

          if (deferredSearch) {
            condition = and(
              condition,
              ilike(post.title, `%${deferredSearch}%`)
            );
          }

          if (statusFilter) {
            // One status dimension: the checklist and the operator apply to the
            // same set. A built-in "Active" tab is this filter with the active
            // types, not a preset that could contradict a checklist.
            condition = and(
              condition,
              statusFilter.operator === "isNot"
                ? not(inArray(postStatus.type, [...statusFilter.types]))
                : inArray(postStatus.type, [...statusFilter.types])
            );
          }

          if (assigneeMemberIds.length > 0) {
            // `inArray` over an empty list matches nothing, which is why the
            // empty case is a skipped branch rather than a predicate: no
            // assignee filter means "anyone, including unassigned", not
            // "nobody".
            condition = and(
              condition,
              inArray(post.assigneeMemberId, [...assigneeMemberIds])
            );
          }

          if (myFeedbackScope) {
            // The page's own scope, anded with whatever the member filtered
            // down to on top of it. `eq` against a string excludes the null
            // `assigneeMemberId` an unassigned post carries, which is what
            // "assigned to me" means.
            condition = and(
              condition,
              myFeedbackScope.kind === "created"
                ? eq(post.creatorMemberId, myFeedbackScope.memberId)
                : eq(post.assigneeMemberId, myFeedbackScope.memberId)
            );
          }

          if (tagFilter) {
            // A missed left join reads as null/undefined (same guard as the
            // changelog completed-posts query).
            const unmatched = or(
              isNull(matchingTags.postId),
              isUndefined(matchingTags.postId)
            );
            if (
              tagFilter.operator === "excludeIfAnyOf" ||
              tagFilter.operator === "excludeIfAllOf"
            ) {
              if (tagFilter.operator === "excludeIfAllOf") {
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
        });

      const orderedQuery =
        ordering.field === "title"
          ? filteredQuery.orderBy(({ post }) => post.title, ordering.direction)
          : ordering.field === "updatedAt"
            ? filteredQuery.orderBy(
                ({ post }) => post.updatedAt,
                ordering.direction
              )
            : ordering.field === "upvoteCount"
              ? filteredQuery.orderBy(
                  ({ upvoteCounts }) => coalesce(upvoteCounts.upvoteCount, 0),
                  ordering.direction
                )
              : filteredQuery.orderBy(
                  ({ post }) => post.createdAt,
                  ordering.direction
                );

      return orderedQuery.select(
        ({ board, post, postStatus, upvoteCounts }) => ({
          archivedAt: post.archivedAt,
          assigneeMemberId: post.assigneeMemberId,
          authorIsMember: post.authorIsMember,
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
        })
      );
    },
  });

  const posts: BoardPostRow[] = postsQuery.data ?? [];

  const postStatuses = useMemo(
    () => visiblePostStatuses(postStatusesQuery.data ?? [], statusFilter),
    [postStatusesQuery.data, statusFilter]
  );

  return {
    hasError:
      isLiveQueryFailed(postStatusesQuery) || isLiveQueryFailed(postsQuery),
    isLoading: postStatusesQuery.isLoading || postsQuery.isLoading,
    postStatuses,
    posts,
  };
}
