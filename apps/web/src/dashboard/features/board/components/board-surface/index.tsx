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
      <div className="mx-auto w-full">
        <BoardToolbar
          boardSlug={boardSlug}
          organizationId={organizationId}
          variant={variant}
        />
        <BoardPosts boardId={boardId} organizationId={organizationId} />
      </div>
    </BoardStoreProvider>
  );
}
