import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterIndex } from "~/features/help-center/components/help-center-index";
import { preloadHelpCenter } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadHelpCenter();

    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <HelpCenterIndex organizationId={organizationId} />;
}
