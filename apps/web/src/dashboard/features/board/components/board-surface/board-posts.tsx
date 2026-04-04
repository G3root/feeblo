import {
  and,
  count,
  eq,
  inArray,
  not,
  or,
  useLiveSuspenseQuery,
} from "@tanstack/react-db";
import { postCollection, postTagCollection } from "~/lib/collections";
import {
  useActiveBoardView,
  useBoardDisplayMode,
} from "../../state/board-store-context";
import { BoardGridView } from "./board-grid-view";
import { BoardListView } from "./board-list-view";
import { BoardPostBulkActions } from "./board-post-bulk-actions";
import { BoardPostsEmpty } from "./board-posts-empty";
import { groupPostByStatusMap } from "./utils";

export function BoardPosts({
  boardId,
  boardSlug,
  organizationId,
}: {
  boardId: string;
  boardSlug: string;
  organizationId: string;
}) {
  const mode = useBoardDisplayMode();
  const activeView = useActiveBoardView();
  const {
    postStatus,
    statusOperator,
    statuses,
    tagIds,
    tagOperator,
  } = activeView.filters;
  const statusesKey = statuses.join(",");
  const tagIdsKey = tagIds.join(",");

  const { data: matchingTagPosts } = useLiveSuspenseQuery(
    (q) => {
      const baseQuery = q.from({ postTag: postTagCollection }).where(({ postTag }) => {
        const conditions = [
          eq(postTag.organizationId, organizationId),
          tagIds.length > 0
            ? inArray(postTag.tagId, tagIds)
            : eq(postTag.postId, "__no_matching_post__"),
        ];

        return and(conditions[0], conditions[1], ...conditions.slice(2));
      });

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

  const matchingTagPostIds = matchingTagPosts.map((entry) => entry.postId);
  const matchingTagPostIdsKey = matchingTagPostIds.join(",");

  const { data: posts } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ post: postCollection })
        .select(({ post }) => ({
          id: post.id,
          slug: post.slug,
          status: post.status,
          title: post.title,
          summary: post.content,
          updatedAt: post.updatedAt,
        }))
        .where(({ post }) =>
          and(
            eq(post.boardId, boardId),
            eq(post.organizationId, organizationId),
            ...(postStatus === "active"
              ? [or(eq(post.status, "PLANNED"), eq(post.status, "IN_PROGRESS"))]
              : []),
            ...(statuses.length > 0
              ? [
                  statusOperator === "isNot"
                    ? not(inArray(post.status, statuses))
                    : inArray(post.status, statuses),
                ]
              : []),
            ...(tagIds.length > 0
              ? [
                  tagOperator === "excludeIfAnyOf" ||
                  tagOperator === "excludeIfAllOf"
                    ? not(inArray(post.id, matchingTagPostIds))
                    : inArray(post.id, matchingTagPostIds),
                ]
              : [])
          )
        )
        .orderBy((post) => post.post.createdAt, "desc");
    },
    [
      boardId,
      organizationId,
      postStatus,
      statusesKey,
      statusOperator,
      tagIdsKey,
      tagOperator,
      matchingTagPostIdsKey,
    ]
  );

  const groupedPosts = groupPostByStatusMap(posts);

  if (posts.length === 0) {
    return (
      <BoardPostsEmpty boardId={boardId} organizationId={organizationId} />
    );
  }

  return (
    <>
      {mode === "grid" ? (
        <BoardGridView
          boardId={boardId}
          boardSlug={boardSlug}
          groupedPosts={groupedPosts}
          organizationId={organizationId}
        />
      ) : (
        <BoardListView
          boardId={boardId}
          boardSlug={boardSlug}
          groupedPosts={groupedPosts}
          organizationId={organizationId}
        />
      )}
      <BoardPostBulkActions />
    </>
  );
}
