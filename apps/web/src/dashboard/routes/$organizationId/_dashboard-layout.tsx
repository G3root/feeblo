import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { DashboardLayout } from "~/layouts/dashboard-layout.tsx";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute("/$organizationId/_dashboard-layout")({
  component: DashboardLayoutComponent,
});

function DashboardLayoutComponent() {
  const {
    organizationCollection,
    boardCollection,
    siteCollection,
    workspacePlanCollection,
  } = useDashboardCollections();

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    async function prefetch() {
      await Promise.all([
        organizationCollection.preload(),
        boardCollection.preload(),
        siteCollection.preload(),
        workspacePlanCollection.preload(),
      ]);
    }
    prefetch();
  }, []);
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}
