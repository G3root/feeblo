import { Suspense } from "react";
import { BoardViewModeProvider } from "../../state/view-mode-context";
import { BoardHeader } from "./board-header";
import { BoardPosts } from "./board-posts";
import { BoardPostsLoading } from "./board-posts-loading";

export function BoardSurface({
  boardId,
  boardName,
  boardSlug,
  organizationId,
  visibility,
}: {
  boardId: string;
  boardName: string;
  boardSlug: string;
  organizationId: string;
  visibility: "PUBLIC" | "PRIVATE";
}) {
  return (
    <BoardViewModeProvider>
      <div className="mx-auto w-full">
        <section className="overflow-hidden text-card-foreground">
          <BoardHeader boardName={boardName} visibility={visibility} />
          <Suspense fallback={<BoardPostsLoading />} key={boardId}>
            <BoardPosts
              boardId={boardId}
              boardSlug={boardSlug}
              organizationId={organizationId}
            />
          </Suspense>
        </section>
      </div>
    </BoardViewModeProvider>
  );
}
