import { createFileRoute } from "@tanstack/react-router";
import {
  ActiveBoardPage,
  BoardFeedbackRoutePending,
} from "~/features/board/components/board-route-pages";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/active"
)({
  component: RouteComponent,
  pendingComponent: BoardFeedbackRoutePending,
});

function RouteComponent() {
  const { organizationId, boardSlug } = Route.useParams();

  return (
    <ActiveBoardPage boardSlug={boardSlug} organizationId={organizationId} />
  );
}
