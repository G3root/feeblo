import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { useEffect } from "react";
import { usePostSelectionStore } from "~/features/board/state/post-selection-context";
import { postCollection } from "~/lib/collections";
import { BOARD_LANES } from "../../constants";
import { useBoardViewMode } from "../../state/view-mode-context";
import { BoardPostBulkActions } from "./board-post-bulk-actions";
import { BoardGridView } from "./board-grid-view";
import { BoardListView } from "./board-list-view";
import { BoardPostsEmpty } from "./board-posts-empty";
import type { BoardLane } from "./types";

export function BoardPosts({
  boardId,
  boardSlug,
  organizationId,
}: {
  boardId: string;
  boardSlug: string;
  organizationId: string;
}) {
  const mode = useBoardViewMode();
  const selectionStore = usePostSelectionStore();

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
            eq(post.organizationId, organizationId)
          )
        )
        .orderBy((post) => post.post.createdAt, "desc");
    },
    [boardId, organizationId]
  );

  useEffect(() => {
    selectionStore.send({
      type: "syncAvailablePostIds",
      postIds: posts.map((post) => post.id),
    });
  }, [posts, selectionStore]);

  const lanes: BoardLane[] = BOARD_LANES.map((lane) => ({
    key: lane.key,
    label: lane.label,
    status: lane.statuses[0],
    toneVar: lane.toneVar,
    posts: posts.filter((post) => lane.statuses.includes(post.status)),
  })).filter((lane) => lane.posts.length > 0);

  if (posts.length === 0) {
    return <BoardPostsEmpty />;
  }

  return (
    <>
      {mode === "grid" ? (
        <BoardGridView
          boardSlug={boardSlug}
          lanes={lanes}
          organizationId={organizationId}
        />
      ) : (
        <BoardListView
          boardId={boardId}
          boardSlug={boardSlug}
          lanes={lanes}
          organizationId={organizationId}
        />
      )}
      <BoardPostBulkActions />
    </>
  );
}
