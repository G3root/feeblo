import { createFileRoute } from "@tanstack/react-router";

import { ChangelogIndex } from "~/features/changelog/components/changelog-index";
import { dashboardCollections } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/changelog/published"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      dashboardCollections.changelogCollection.preload(),
      dashboardCollections.changelogCategoryCollection.preload(),
      dashboardCollections.changelogCategoryLinkCollection.preload(),
    ]);

    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return (
    <ChangelogIndex organizationId={organizationId} statuses={["published"]} />
  );
}
