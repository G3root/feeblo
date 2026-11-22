import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { InsightsPage } from "~/features/insights/components/insights-page";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/insights/help-center"
)({
  component: RouteComponent,
  beforeLoad: ({ params }) => {
    // The tab exists only while the help center does. A bookmarked URL from a
    // deployment that turned the flag off lands on feedback rather than on a
    // page for a surface this deployment does not serve.
    if (!isFeatureEnabled("HELP_CENTER")) {
      throw redirect({
        params: { organizationId: params.organizationId },
        to: "/$organizationId/insights",
      });
    }

    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <InsightsPage organizationId={organizationId} tab="help-center" />;
}
