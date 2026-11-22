import { createFileRoute } from "@tanstack/react-router";

import { DEFAULT_INSIGHTS_RANGE } from "~/features/insights/atoms";
import { InsightsPage } from "~/features/insights/components/insights-page";
import { insightsSearchSchema } from "~/features/insights/search";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/insights/"
)({
  validateSearch: (search) => insightsSearchSchema.parse(search),
  component: RouteComponent,
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
      tab="feedback"
    />
  );
}
