import { createFileRoute } from "@tanstack/react-router";

import { DashboardRoadmapDetailView } from "~/features/roadmap/components/dashboard-roadmap-view";
import { preloadRoadmap } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/roadmap/$slug"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadRoadmap();
    return null;
  },
});

function RouteComponent() {
  const { organizationId, slug } = Route.useParams();
  return (
    <DashboardRoadmapDetailView organizationId={organizationId} slug={slug} />
  );
}
