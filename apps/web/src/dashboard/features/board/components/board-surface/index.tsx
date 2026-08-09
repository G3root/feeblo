import {
  BoardStoreProvider,
  type BoardView,
} from "../../state/board-store-context";
import { BoardPosts } from "./board-posts";
import { BoardToolbar } from "./board-toolbar";

export function BoardSurface({
  boardId,
  boardSlug,
  organizationId,
  initialView,
  variant = "board",
}: {
  boardId?: string;
  boardSlug?: string;
  initialView: BoardView;
  organizationId: string;
  variant?: "board" | "feedback";
}) {
  const surfaceKey = boardId ?? `${organizationId}:${variant}`;

  return (
    <BoardStoreProvider
      defaultValue={{
        activeView: initialView,
        boardId,
      }}
      key={surfaceKey}
    >
      <div className="mx-auto flex h-full min-h-0 w-full flex-col">
        <div className="shrink-0">
          <BoardToolbar
            boardSlug={boardSlug}
            organizationId={organizationId}
            variant={variant}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <BoardPosts boardId={boardId} organizationId={organizationId} />
        </div>
      </div>
    </BoardStoreProvider>
  );
}
