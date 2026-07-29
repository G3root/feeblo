import { createFileRoute } from "@tanstack/react-router";
import { IncomingFeedbackPage } from "~/features/feedback-ingestion/components/incoming-feedback-page";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/feedback/incoming"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <IncomingFeedbackPage organizationId={organizationId} />;
}
