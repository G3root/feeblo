import { createFileRoute } from "@tanstack/react-router";

import { AssignedFeedbackPage } from "~/features/board/components/board-route-pages";
import { preloadBoardPosts } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/feedback/assigned"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadBoardPosts();
    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <AssignedFeedbackPage organizationId={organizationId} />;
}
