import { useFeatureFlag } from "@feeblo/web-shared/use-feature-flag";
import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterArticleEditor } from "~/features/help-center/components/help-center-article-editor";
import { HelpCenterUnavailable } from "~/features/help-center/components/help-center-unavailable";
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

  if (!useFeatureFlag("HELP_CENTER")) {
    return <HelpCenterUnavailable />;
  }

  return <HelpCenterArticleEditor organizationId={organizationId} />;
}
