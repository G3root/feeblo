import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SettingsLayout } from "~/layouts/settings-layout";

export const Route = createFileRoute("/$organizationId/settings")({
  component: SettingsLayoutRoute,
});

function SettingsLayoutRoute() {
  return (
    <SettingsLayout>
      <Outlet />
    </SettingsLayout>
  );
}
