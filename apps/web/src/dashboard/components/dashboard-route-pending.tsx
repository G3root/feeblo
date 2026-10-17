import { Spinner } from "@feeblo/ui/spinner";
import type React from "react";

/**
 * The dashboard's per-route pending placeholder, wired as the router default.
 *
 * It renders inside whichever layout is already mounted — the dashboard shell
 * on an in-app navigation, the settings layout inside it — so a slow route
 * load keeps the chrome and swaps only the content area. The full-page loader
 * for a load with no shell yet is `DashboardPendingShell`, owned by the
 * `_dashboard` and `_dashboard-layout` routes.
 *
 * `min-h` rather than `h-dvh`: inside the dashboard's scroll area a
 * full-viewport height would add a scrollbar.
 */
export function DashboardRoutePending(): React.ReactElement {
  return (
    <div
      className="flex min-h-[70svh] w-full items-center justify-center p-6"
      data-slot="dashboard-pending"
    >
      <Spinner className="text-muted-foreground size-6" />
    </div>
  );
}
