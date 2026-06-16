import { createFileRoute } from "@tanstack/react-router";
import { ChangelogIndex } from "~/features/changelog/components/changelog-index";
import { changelogCollection } from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/changelog/published"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await changelogCollection.preload();

    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return (
    <ChangelogIndex organizationId={organizationId} statuses={["published"]} />
  );
}
