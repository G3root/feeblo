import { createFileRoute } from "@tanstack/react-router";

import { HelpCenterSectionPage } from "~/features/help-center/components/help-center-section-page";
import { preloadHelpCenterSection } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/help-center/$topicId/"
)({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    await preloadHelpCenterSection(params.topicId);

    return null;
  },
});

function RouteComponent() {
  const { organizationId, topicId } = Route.useParams();

  return (
    <HelpCenterSectionPage organizationId={organizationId} topicId={topicId} />
  );
}
