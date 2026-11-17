import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import { useFeatureFlag } from "@feeblo/web-shared/use-feature-flag";
import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterIndex } from "~/features/help-center/components/help-center-index";
import { HelpCenterUnavailable } from "~/features/help-center/components/help-center-unavailable";
import { preloadHelpCenter } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    // Nothing is rendered while the flag is off, so preloading both
    // collections would be a request for a page that cannot use it.
    if (isFeatureEnabled("HELP_CENTER")) {
      await preloadHelpCenter();
    }

    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <HelpCenterIndex organizationId={organizationId} />;
}
