import { createFileRoute } from "@tanstack/react-router";
import { BacklogBoardPage } from "~/features/board/components/board-route-pages";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/backlog"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId, boardSlug } = Route.useParams();

  return (
    <BacklogBoardPage boardSlug={boardSlug} organizationId={organizationId} />
  );
}
