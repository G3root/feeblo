import { createFileRoute } from "@tanstack/react-router";

import { DashboardRoadmapIndexView } from "~/features/roadmap/components/dashboard-roadmap-view";
import { preloadRoadmap } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/roadmap/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadRoadmap();
    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();
  return <DashboardRoadmapIndexView organizationId={organizationId} />;
}
