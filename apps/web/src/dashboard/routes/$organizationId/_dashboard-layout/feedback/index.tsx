import { createFileRoute } from "@tanstack/react-router";
import { AllFeedbackPage } from "~/features/board/components/board-route-pages";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/feedback/"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <AllFeedbackPage organizationId={organizationId} />;
}
