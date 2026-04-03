import { Suspense } from "react";
import { PostSelectionProvider } from "../../state/post-selection-context";
import { BoardViewModeProvider } from "../../state/view-mode-context";
import { BoardPosts } from "./board-posts";
import { BoardPostsLoading } from "./board-posts-loading";
import { BoardToolbar } from "./board-toolbar";

export function BoardSurface({
  boardId,
  boardSlug,
  organizationId,
}: {
  boardId: string;
  boardName: string;
  boardSlug: string;
  organizationId: string;
}) {
  return (
    <BoardViewModeProvider>
      <PostSelectionProvider key={boardId}>
        <div className="mx-auto w-full">
          <BoardToolbar />
          <Suspense fallback={<BoardPostsLoading />} key={boardId}>
            <BoardPosts
              boardId={boardId}
              boardSlug={boardSlug}
              organizationId={organizationId}
            />
          </Suspense>
        </div>
      </PostSelectionProvider>
    </BoardViewModeProvider>
  );
}
