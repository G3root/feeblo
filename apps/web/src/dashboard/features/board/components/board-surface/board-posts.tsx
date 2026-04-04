import { and, eq, or, useLiveSuspenseQuery } from "@tanstack/react-db";
import { postCollection } from "~/lib/collections";
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
  const postStatus = activeView.filters.postStatus;

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
              : [])
          )
        )
        .orderBy((post) => post.post.createdAt, "desc");
    },
    [boardId, organizationId, postStatus]
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
