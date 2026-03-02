import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { postCollection } from "~/lib/collections";
import { BOARD_LANES } from "../../constants";
import { useBoardViewMode } from "../../state/view-mode-context";
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

  if (mode === "grid") {
    return (
      <BoardGridView
        boardSlug={boardSlug}
        lanes={lanes}
        organizationId={organizationId}
      />
    );
  }

  return (
    <BoardListView
      boardId={boardId}
      boardSlug={boardSlug}
      lanes={lanes}
      organizationId={organizationId}
    />
  );
}
