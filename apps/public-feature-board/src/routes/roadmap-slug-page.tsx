import { createLazyRoute, getRouteApi } from "@tanstack/react-router";

import { PublicRoadmapPage } from "../components/roadmap/public-roadmap-page";

const roadmapSlugRouteApi = getRouteApi("/roadmap/$slug");

export const Route = createLazyRoute("/roadmap/$slug")({
  component: RoadmapSlugPage,
});

function RoadmapSlugPage() {
  const { slug } = roadmapSlugRouteApi.useParams();

  return <PublicRoadmapPage slug={slug} />;
}
