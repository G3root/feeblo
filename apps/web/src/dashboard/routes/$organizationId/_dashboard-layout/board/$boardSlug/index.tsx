import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { BoardNotFound } from "~/features/board/components/board-not-found";
import { BoardSurface } from "~/features/board/components/board-surface";
import { boardCollection } from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId, boardSlug } = Route.useParams();

  const { data: board } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ board: boardCollection })
        .where((entry) =>
          and(
            eq(entry.board.slug, boardSlug),
            eq(entry.board.organizationId, organizationId)
          )
        )
        .findOne();
    },
    [boardSlug, organizationId]
  );

  if (!board) {
    return (
      <BoardNotFound boardSlug={boardSlug} organizationId={organizationId} />
    );
  }

  return (
    <BoardSurface
      boardId={board.id}
      boardName={board.name}
      boardSlug={boardSlug}
      organizationId={organizationId}
      visibility={board.visibility}
    />
  );
}
