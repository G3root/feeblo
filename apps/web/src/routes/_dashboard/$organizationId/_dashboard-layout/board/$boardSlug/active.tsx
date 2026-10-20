import { createFileRoute } from "@tanstack/react-router";

import { ActiveBoardPage } from "~/features/board/components/board-route-pages";
import { preloadBoardPosts } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/board/$boardSlug/active"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadBoardPosts();
    return null;
  },
});

function RouteComponent() {
  const { organizationId, boardSlug } = Route.useParams();

  return (
    <ActiveBoardPage boardSlug={boardSlug} organizationId={organizationId} />
  );
}
