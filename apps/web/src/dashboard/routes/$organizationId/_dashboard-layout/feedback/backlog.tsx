import { createFileRoute } from "@tanstack/react-router";
import {
  BacklogFeedbackPage,
  BoardFeedbackRoutePending,
} from "~/features/board/components/board-route-pages";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/feedback/backlog"
)({
  component: RouteComponent,
  pendingComponent: BoardFeedbackRoutePending,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <BacklogFeedbackPage organizationId={organizationId} />;
}
