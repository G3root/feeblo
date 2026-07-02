import { initAuthStateCache } from "@feeblo/web-shared/auth-client";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/$organizationId")({
  component: OrganizationLayoutRoute,
  beforeLoad: () => initAuthStateCache(),
});

function OrganizationLayoutRoute() {
  return <Outlet />;
}
