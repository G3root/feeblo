import { Suspense, lazy, useMemo } from "react";

import {
  useActiveBoardView,
  useBoardDisplayMode,
} from "../../state/board-store-context";
import { BoardListView } from "./board-list-view";
import { BoardPostBulkActions } from "./board-post-bulk-actions";
import { BoardPostsEmpty } from "./board-posts-empty";
import { BoardPostsLoading } from "./board-posts-loading";
import { useBoardPostsData } from "./use-board-posts-data";
import { groupPostsByStatus } from "./utils";

// The grid view pulls in @dnd-kit (drag-and-drop) plus its lane/card
// modules. List is the default mode, so split the grid off the initial
// chunk and load it only when actually rendered.
const BoardGridView = lazy(() =>
  import("./board-grid-view").then((module) => ({
    default: module.BoardGridView,
  }))
);

export function BoardPosts({
  boardId,
  organizationId,
}: {
  boardId?: string;
  organizationId: string;
}) {
  const mode = useBoardDisplayMode();
  const activeView = useActiveBoardView();
  const {
    postStatus: postStatusFilter,
    search,
    statusOperator,
    statuses,
    tagIds,
    tagOperator,
  } = activeView.filters;
  const { hasError, isLoading, postStatuses, posts } = useBoardPostsData({
    boardId,
    organizationId,
    postStatusFilter,
    search,
    statusOperator,
    statuses,
    tagIds,
    tagOperator,
  });

  // `posts`/`postStatuses` are referentially stable (memoized in the hook),
  // so grouping here preserves lane identity across unrelated renders and
  // the memoized lane components below actually skip work.
  const lanes = useMemo(
    () =>
      groupPostsByStatus(
        posts,
        postStatuses.map((postStatus) => ({
          id: postStatus.id,
          type: postStatus.type,
          label: postStatus.label,
        }))
      ),
    [posts, postStatuses]
  );

  if (hasError) {
    throw new Error("Failed to load board posts");
  }

  if (isLoading) {
    return <BoardPostsLoading />;
  }

  if (posts.length === 0) {
    return (
      <BoardPostsEmpty
        boardId={boardId}
        hasFilters={
          search.trim().length > 0 || statuses.length > 0 || tagIds.length > 0
        }
        organizationId={organizationId}
      />
    );
  }

  return (
    <>
      {mode === "grid" ? (
        <Suspense fallback={<BoardPostsLoading />}>
          <BoardGridView
            boardId={boardId}
            groupedPosts={lanes}
            organizationId={organizationId}
          />
        </Suspense>
      ) : (
        <BoardListView
          boardId={boardId}
          groupedPosts={lanes}
          organizationId={organizationId}
        />
      )}
      <BoardPostBulkActions />
    </>
  );
}
