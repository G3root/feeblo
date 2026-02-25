import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Skeleton } from "~/components/ui/skeleton";
import { DashboardLayout } from "~/layouts/dashboard-layout.tsx";

export const Route = createFileRoute("/$organizationId/_dashboard-layout")({
  component: DashboardLayoutComponent,
  pendingComponent: DashboardLayoutPending,
});

function DashboardLayoutComponent() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}

function DashboardLayoutPending() {
  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[980px] px-4 py-6 md:px-6 md:py-8">
        <div className="space-y-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-3/5" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>
    </DashboardLayout>
  );
}
