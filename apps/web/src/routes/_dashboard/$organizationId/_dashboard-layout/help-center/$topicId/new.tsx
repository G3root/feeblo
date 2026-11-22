import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import { useFeatureFlag } from "@feeblo/web-shared/use-feature-flag";
import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterArticleEditor } from "~/features/help-center/components/help-center-article-editor";
import { HelpCenterUnavailable } from "~/features/help-center/components/help-center-unavailable";
import { preloadHelpCenterEditor } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/$topicId/new"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    if (isFeatureEnabled("HELP_CENTER")) {
      await preloadHelpCenterEditor();
    }

    return null;
  },
});

function RouteComponent() {
  const { organizationId, topicId } = Route.useParams();
  const enabled = useFeatureFlag("HELP_CENTER");

  if (!enabled) {
    return <HelpCenterUnavailable />;
  }

  return (
    <HelpCenterArticleEditor
      mode="create"
      organizationId={organizationId}
      topicId={topicId}
    />
  );
}
