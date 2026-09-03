import { createFileRoute } from "@tanstack/react-router";

import { ActiveFeedbackPage } from "~/features/board/components/board-route-pages";
import { preloadBoardPostsDataCollections } from "~/features/board/components/board-surface/use-board-posts-data";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/feedback/active"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadBoardPostsDataCollections();
    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <ActiveFeedbackPage organizationId={organizationId} />;
}
