import { createFileRoute, Outlet } from "@tanstack/react-router";

import { DashboardPendingShell } from "~/components/dashboard-pending-shell";
import { DashboardLayout } from "~/layouts/dashboard-layout";
import { preloadDashboardShell } from "~/lib/preloads";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout"
)({
  beforeLoad: async () => {
    // Shell-level collections only: the sidebar and plan gates need these
    // on every page. Page-specific collections (posts, tags, changelogs,
    // …) preload in their own routes so settings/members/billing never pay
    // for board data and vice versa.
    await preloadDashboardShell();
    return null;
  },
  component: DashboardLayoutComponent,
  // Hold the shell-shaped loader through the layout's own preloads, so the
  // sidebar never appears after the content it frames.
  pendingComponent: DashboardPendingShell,
});

function DashboardLayoutComponent() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}
