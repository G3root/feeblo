import { createFileRoute } from "@tanstack/react-router";

import { InsightsPage } from "~/features/insights/components/insights-page";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/insights"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <InsightsPage organizationId={organizationId} />;
}
