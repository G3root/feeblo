import { createFileRoute } from "@tanstack/react-router";

import { SavedFeedbackViewPage } from "~/features/board/components/board-route-pages";
import { preloadBoardPosts } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/feedback/view/$viewId"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadBoardPosts();
    return null;
  },
});

function RouteComponent() {
  const { organizationId, viewId } = Route.useParams();

  return (
    <SavedFeedbackViewPage organizationId={organizationId} viewId={viewId} />
  );
}
