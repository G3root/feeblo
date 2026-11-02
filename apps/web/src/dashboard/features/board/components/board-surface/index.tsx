import {
  type BoardOrdering,
  BoardStoreProvider,
  type BoardView,
} from "../../state/board-store-context";
import { BoardPosts } from "./board-posts";
import { BoardToolbar } from "./board-toolbar";

export function BoardSurface({
  boardId,
  boardSlug,
  organizationId,
  initialOrdering,
  initialView,
  variant = "board",
}: {
  boardId?: string;
  boardSlug?: string;
  /** A saved view's stored sort order; omitted for the built-in presets. */
  initialOrdering?: BoardOrdering;
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
        ...(initialOrdering !== undefined && { ordering: initialOrdering }),
      }}
      key={surfaceKey}
    >
      <div className="mx-auto flex h-full min-h-0 w-full flex-col">
        <div className="shrink-0">
          <BoardToolbar
            boardId={boardId}
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
