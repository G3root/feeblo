import { createFileRoute, Outlet } from "@tanstack/react-router";

import { DashboardLayout } from "~/layouts/dashboard-layout.tsx";
import {
  boardCollection,
  organizationCollection,
  workspacePlanCollection,
} from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/_dashboard-layout")({
  beforeLoad: async () => {
    // Shell-level collections only: the sidebar and plan gates need these
    // on every page. Page-specific collections (posts, tags, changelogs,
    // …) preload in their own routes so settings/members/billing never pay
    // for board data and vice versa.
    await Promise.all([
      organizationCollection.preload(),
      boardCollection.preload(),
      workspacePlanCollection.preload(),
    ]);
    return null;
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
