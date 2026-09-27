import {
  preloadBoardRoadmap,
  type PreloadOutcome,
} from "@feeblo/public-feature-board";
import { BoardRoadmapPage } from "@feeblo/public-feature-board/pages/roadmap";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/s/roadmap/")({
  beforeLoad: ({ context }): Promise<PreloadOutcome> =>
    preloadBoardRoadmap(context.dbClient),
  component: BoardRoadmapRoute,
});

function BoardRoadmapRoute() {
  return <BoardRoadmapPage />;
}
