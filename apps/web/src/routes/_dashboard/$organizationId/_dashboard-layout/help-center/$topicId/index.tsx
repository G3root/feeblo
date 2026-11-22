import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import { useFeatureFlag } from "@feeblo/web-shared/use-feature-flag";
import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterSectionPage } from "~/features/help-center/components/help-center-section-page";
import { HelpCenterUnavailable } from "~/features/help-center/components/help-center-unavailable";
import { preloadHelpCenterSection } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/$topicId/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    if (isFeatureEnabled("HELP_CENTER")) {
      await preloadHelpCenterSection();
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
    <HelpCenterSectionPage organizationId={organizationId} topicId={topicId} />
  );
}
