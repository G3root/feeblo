import { createFileRoute } from "@tanstack/react-router";

import { DashboardRoadmapIndexView } from "~/features/roadmap/components/dashboard-roadmap-view";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
  roadmapCollection,
  roadmapColumnCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/roadmap/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      boardCollection.preload(),
      postCollection.preload(),
      postStatusCollection.preload(),
      roadmapCollection.preload(),
      roadmapColumnCollection.preload(),
    ]);
    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();
  return <DashboardRoadmapIndexView organizationId={organizationId} />;
}
