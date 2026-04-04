import { Suspense } from "react";
import {
  BoardStoreProvider,
  type BoardView,
} from "../../state/board-store-context";
import { BoardPosts } from "./board-posts";
import { BoardPostsLoading } from "./board-posts-loading";
import { BoardToolbar } from "./board-toolbar";

export function BoardSurface({
  boardId,
  boardSlug,
  organizationId,
  initialView,
}: {
  boardId: string;
  boardSlug: string;
  initialView: BoardView;
  organizationId: string;
}) {
  return (
    <BoardStoreProvider
      defaultValue={{
        activeView: initialView,
        boardId,
      }}
      key={boardId}
    >
      <div className="mx-auto w-full">
        <BoardToolbar boardSlug={boardSlug} organizationId={organizationId} />
        <Suspense fallback={<BoardPostsLoading />} key={boardId}>
          <BoardPosts
            boardId={boardId}
            boardSlug={boardSlug}
            organizationId={organizationId}
          />
        </Suspense>
      </div>
    </BoardStoreProvider>
  );
}
