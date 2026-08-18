import { createFileRoute } from "@tanstack/react-router";

import { ChangelogIndex } from "~/features/changelog/components/changelog-index";
import {
  changelogCategoryCollection,
  changelogCategoryLinkCollection,
  changelogCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/changelog/draft"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      changelogCollection.preload(),
      changelogCategoryCollection.preload(),
      changelogCategoryLinkCollection.preload(),
    ]);

    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return (
    <ChangelogIndex organizationId={organizationId} statuses={["draft"]} />
  );
}
