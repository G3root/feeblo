import { createFileRoute } from "@tanstack/react-router";
import { AllBoardPage } from "~/features/board/components/board-route-pages";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId, boardSlug } = Route.useParams();

  return <AllBoardPage boardSlug={boardSlug} organizationId={organizationId} />;
}
