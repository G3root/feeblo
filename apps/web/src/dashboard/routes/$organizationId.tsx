import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DashboardCollectionsProvider } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute("/$organizationId")({
  component: OrganizationLayoutRoute,
});

function OrganizationLayoutRoute() {
  const { organizationId } = Route.useParams();

  return (
    <DashboardCollectionsProvider organizationId={organizationId}>
      <Outlet />
    </DashboardCollectionsProvider>
  );
}
