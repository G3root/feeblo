import { createFileRoute } from "@tanstack/react-router";

import { SavedBoardViewPage } from "~/features/board/components/board-route-pages";
import { preloadBoardPosts } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/board/$boardSlug/view/$viewId"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadBoardPosts({ needsMembers: true });
    return null;
  },
});

function RouteComponent() {
  const { organizationId, boardSlug, viewId } = Route.useParams();

  return (
    <SavedBoardViewPage
      boardSlug={boardSlug}
      organizationId={organizationId}
      viewId={viewId}
    />
  );
}
