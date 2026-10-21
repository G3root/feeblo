import { createFileRoute } from "@tanstack/react-router";

import { ChangelogIndex } from "~/features/changelog/components/changelog-index";
import { preloadChangelog } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/changelog/published"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await preloadChangelog();

    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return (
    <ChangelogIndex organizationId={organizationId} statuses={["published"]} />
  );
}
