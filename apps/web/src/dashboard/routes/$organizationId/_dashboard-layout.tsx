import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DashboardLayout } from "~/layouts/dashboard-layout.tsx";
import { DashboardCollectionsProvider } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute("/$organizationId/_dashboard-layout")({
  component: DashboardLayoutComponent,
});

function DashboardLayoutComponent() {
  const { organizationId } = Route.useParams();

  return (
    <DashboardCollectionsProvider organizationId={organizationId}>
      <DashboardLayout>
        <Outlet />
      </DashboardLayout>
    </DashboardCollectionsProvider>
  );
}
