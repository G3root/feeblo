import { createFileRoute } from "@tanstack/react-router";
import {
  ChangelogIndex,
  ChangelogIndexPending,
} from "~/features/changelog/components/changelog-index";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/changelog/"
)({
  component: RouteComponent,
  pendingComponent: ChangelogIndexPending,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();
  return <ChangelogIndex organizationId={organizationId} />;
}
