import { createFileRoute } from "@tanstack/react-router";
import { ChangelogIndex } from "~/features/changelog/components/changelog-index";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/changelog/draft"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  return <ChangelogIndex organizationId={organizationId} statuses={["draft"]} />;
}
