import { createFileRoute } from "@tanstack/react-router";

import { ActiveBoardPage } from "~/features/board/components/board-route-pages";
import { preloadBoardPostsDataCollections } from "~/features/board/components/board-surface/use-board-posts-data";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/active"
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
    <ActiveBoardPage boardSlug={boardSlug} organizationId={organizationId} />
  );
}
