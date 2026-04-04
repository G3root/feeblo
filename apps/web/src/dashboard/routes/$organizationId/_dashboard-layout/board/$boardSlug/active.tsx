import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "~/components/ui/skeleton";
import { BoardNotFound } from "~/features/board/components/board-not-found";
import { BoardSurface } from "~/features/board/components/board-surface";
import { boardCollection } from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/active"
)({
  component: RouteComponent,
  pendingComponent: BoardRoutePending,
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
      boardSlug={boardSlug}
      initialView={{
        id: "active-feedback",
        name: "Active",
        filters: {
          postStatus: "active",
        },
      }}
      organizationId={organizationId}
    />
  );
}

function BoardRoutePending() {
  return (
    <div className="mx-auto w-full">
      <section className="overflow-hidden text-card-foreground">
        <div className="space-y-6 border-b px-4 py-6 lg:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>
        <div className="space-y-3 px-4 py-4 lg:px-6">
          <Skeleton className="h-11 w-full rounded-none" />
          <Skeleton className="h-11 w-full rounded-none" />
          <Skeleton className="h-11 w-full rounded-none" />
        </div>
      </section>
    </div>
  );
}
