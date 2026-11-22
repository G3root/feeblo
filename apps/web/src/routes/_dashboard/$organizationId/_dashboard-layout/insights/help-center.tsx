import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { DEFAULT_INSIGHTS_RANGE } from "~/features/insights/atoms";
import { InsightsPage } from "~/features/insights/components/insights-page";
import { insightsSearchSchema } from "~/features/insights/search";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/insights/help-center"
)({
  validateSearch: (search) => insightsSearchSchema.parse(search),
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
  const { range } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <InsightsPage
      onRangeChange={(next) =>
        void navigate({
          replace: true,
          search: (previous) => ({ ...previous, range: next }),
        })
      }
      organizationId={organizationId}
      range={range ?? DEFAULT_INSIGHTS_RANGE}
      tab="help-center"
    />
  );
}
