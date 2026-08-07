import { createLazyRoute } from "@tanstack/react-router";
import { PublicRoadmapPage } from "../components/roadmap/public-roadmap-page";

export const Route = createLazyRoute("/roadmap")({
  component: RoadmapPage,
});

function RoadmapPage() {
  return <PublicRoadmapPage />;
}
