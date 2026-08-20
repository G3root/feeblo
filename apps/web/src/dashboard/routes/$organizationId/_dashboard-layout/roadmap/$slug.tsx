import { createFileRoute } from "@tanstack/react-router";

import { DashboardRoadmapDetailView } from "~/features/roadmap/components/dashboard-roadmap-view";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
  roadmapCollection,
  roadmapColumnCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/roadmap/$slug"
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
  const { organizationId, slug } = Route.useParams();
  return (
    <DashboardRoadmapDetailView organizationId={organizationId} slug={slug} />
  );
}
