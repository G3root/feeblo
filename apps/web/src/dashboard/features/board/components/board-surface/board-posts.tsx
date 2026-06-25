import {
  useActiveBoardView,
  useBoardDisplayMode,
} from "../../state/board-store-context";
import { BoardGridView } from "./board-grid-view";
import { BoardListView } from "./board-list-view";
import { BoardPostBulkActions } from "./board-post-bulk-actions";
import { BoardPostsEmpty } from "./board-posts-empty";
import { BoardPostsLoading } from "./board-posts-loading";
import { useBoardPostsData } from "./use-board-posts-data";
import { groupPostsByStatus } from "./utils";

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

  if (hasError) {
    throw new Error("Failed to load board posts");
  }

  if (isLoading) {
    return <BoardPostsLoading />;
  }

  const groupedPosts = groupPostsByStatus(
    posts,
    postStatuses.map((postStatus) => ({
      id: postStatus.id,
      type: postStatus.type,
    }))
  );

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
        <BoardGridView
          boardId={boardId}
          groupedPosts={groupedPosts}
          organizationId={organizationId}
        />
      ) : (
        <BoardListView
          boardId={boardId}
          groupedPosts={groupedPosts}
          organizationId={organizationId}
        />
      )}
      <BoardPostBulkActions />
    </>
  );
}
