import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterArticleEditor } from "~/features/help-center/components/help-center-article-editor";
import { preloadHelpCenterEditor } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/new"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadHelpCenterEditor();

    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <HelpCenterArticleEditor organizationId={organizationId} />;
}
