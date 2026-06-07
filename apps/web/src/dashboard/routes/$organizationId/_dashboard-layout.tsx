import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DashboardLayout } from "~/layouts/dashboard-layout.tsx";
import {
  boardCollection,
  organizationCollection,
  siteCollection,
  workspacePlanCollection,
} from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/_dashboard-layout")({
  beforeLoad: async () => {
    await Promise.all([
      organizationCollection.preload(),
      boardCollection.preload(),
      siteCollection.preload(),
      workspacePlanCollection.preload(),
    ]);
  },
  component: DashboardLayoutComponent,
});

function DashboardLayoutComponent() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}
