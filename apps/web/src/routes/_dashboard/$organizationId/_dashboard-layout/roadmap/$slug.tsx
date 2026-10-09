import { createFileRoute } from "@tanstack/react-router";

import { DashboardRoadmapDetailView } from "~/features/roadmap/components/dashboard-roadmap-view";
import { dashboardCollections } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/roadmap/$slug"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      dashboardCollections.boardCollection.preload(),
      dashboardCollections.postCollection.preload(),
      dashboardCollections.postStatusCollection.preload(),
      dashboardCollections.roadmapCollection.preload(),
      dashboardCollections.roadmapColumnCollection.preload(),
    ]);
    return null;
  },
});

function RouteComponent() {
  const { organizationId, slug } = Route.useParams();
  return (
    <DashboardRoadmapDetailView organizationId={organizationId} slug={slug} />
  );
}
