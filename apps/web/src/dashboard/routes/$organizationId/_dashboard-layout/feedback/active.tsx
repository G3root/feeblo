import { createFileRoute } from "@tanstack/react-router";
import {
  ActiveFeedbackPage,
  BoardFeedbackRoutePending,
} from "~/features/board/components/board-route-pages";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/feedback/active"
)({
  component: RouteComponent,
  pendingComponent: BoardFeedbackRoutePending,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <ActiveFeedbackPage organizationId={organizationId} />;
}
