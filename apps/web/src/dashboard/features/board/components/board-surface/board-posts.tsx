import {
  BOARD_QUERY_VERSION,
  hasActiveBoardFilters,
  type TBoardQuery,
} from "@feeblo/domain-contracts/board-query";
import { Suspense, lazy, useMemo } from "react";

import type { MyFeedbackScope } from "../../lib/my-feedback-views";
import {
  useActiveBoardView,
  useBoardDisplayMode,
  useBoardGrouping,
  useBoardOrdering,
} from "../../state/board-store-context";
import { BoardListView } from "./board-list-view";
import { BoardPostBulkActions } from "./board-post-bulk-actions";
import { BoardPostsEmpty } from "./board-posts-empty";
import { BoardPostsLoading } from "./board-posts-loading";
import { useBoardGroupingData } from "./use-board-grouping-data";
import { useBoardPostsData } from "./use-board-posts-data";
import { groupBoardPosts } from "./utils";

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
  myFeedbackScope,
  organizationId,
}: {
  boardId?: string;
  /** Set on the member's own feedback page: "created" or "assigned" to them. */
  myFeedbackScope?: MyFeedbackScope;
  organizationId: string;
}) {
  const mode = useBoardDisplayMode();
  const ordering = useBoardOrdering();
  const grouping = useBoardGrouping();
  const activeView = useActiveBoardView();
  // The store holds the pieces; the live query takes the document. Rebuilding
  // it here is what keeps the hook's input the same shape the row stores, so
  // the filters, the grouping and the ordering cannot be threaded through
  // three different parameter lists that drift.
  const query = useMemo<TBoardQuery>(
    () => ({
      version: BOARD_QUERY_VERSION,
      filters: activeView.filters,
      grouping,
      ordering,
    }),
    [activeView.filters, grouping, ordering]
  );
  const {
    hasError: hasGroupingError,
    members,
    postTagsByPostId,
    tags,
  } = useBoardGroupingData(organizationId, grouping.field);
  const { hasError, isLoading, postStatuses, posts } = useBoardPostsData({
    boardId,
    myFeedbackScope,
    organizationId,
    query,
  });

  // `posts`/`postStatuses` are referentially stable (memoized in the hook),
  // so grouping here preserves lane identity across unrelated renders and
  // the memoized lane components below actually skip work.
  const lanes = useMemo(
    () =>
      groupBoardPosts({
        groupBy: grouping.field,
        members,
        postStatuses,
        postTagsByPostId,
        posts,
        tags,
      }),
    [grouping.field, members, postStatuses, postTagsByPostId, posts, tags]
  );

  if (hasError || hasGroupingError) {
    throw new Error("Failed to load board posts");
  }

  if (isLoading) {
    return <BoardPostsLoading />;
  }

  if (posts.length === 0) {
    return (
      <BoardPostsEmpty
        boardId={boardId}
        hasFilters={hasActiveBoardFilters(activeView.filters)}
        myFeedbackView={myFeedbackScope?.kind}
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
            groupBy={grouping.field}
            groupedPosts={lanes}
            organizationId={organizationId}
          />
        </Suspense>
      ) : (
        <BoardListView
          boardId={boardId}
          groupBy={grouping.field}
          groupedPosts={lanes}
          organizationId={organizationId}
        />
      )}
      <BoardPostBulkActions />
    </>
  );
}
