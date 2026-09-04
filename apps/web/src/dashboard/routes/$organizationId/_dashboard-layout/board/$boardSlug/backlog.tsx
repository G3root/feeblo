import { createFileRoute } from "@tanstack/react-router";

import { BacklogBoardPage } from "~/features/board/components/board-route-pages";
import { preloadBoardPostsDataCollections } from "~/features/board/components/board-surface/use-board-posts-data";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/backlog"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadBoardPostsDataCollections();
    return null;
  },
});

function RouteComponent() {
  const { organizationId, boardSlug } = Route.useParams();

  return (
    <BacklogBoardPage boardSlug={boardSlug} organizationId={organizationId} />
  );
}
