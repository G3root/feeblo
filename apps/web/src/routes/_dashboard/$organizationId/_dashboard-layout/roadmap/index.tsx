import { createFileRoute } from "@tanstack/react-router";

import { DashboardRoadmapIndexView } from "~/features/roadmap/components/dashboard-roadmap-view";
import { dashboardCollections } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/roadmap/"
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
  const { organizationId } = Route.useParams();
  return <DashboardRoadmapIndexView organizationId={organizationId} />;
}
