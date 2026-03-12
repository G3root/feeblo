import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DashboardLayout } from "~/layouts/dashboard-layout.tsx";

export const Route = createFileRoute("/$organizationId/_dashboard-layout")({
  component: DashboardLayoutComponent,
});

function DashboardLayoutComponent() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}
