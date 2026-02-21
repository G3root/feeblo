import { Outlet, createFileRoute } from '@tanstack/react-router';
import { DashboardLayout } from '~/layouts/dashboard-layout.tsx';

export const Route = createFileRoute('/_dashboard-layout')({
  component: DashboardLayoutComponent,
  loader: () => {
    return;
  },
});

function DashboardLayoutComponent() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}
