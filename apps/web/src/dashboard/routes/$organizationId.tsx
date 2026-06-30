import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  authClient,
  getAuthState,
  updateAuthState,
} from "@feeblo/web-shared/auth-client";

export const Route = createFileRoute("/$organizationId")({
  component: OrganizationLayoutRoute,
  beforeLoad: async () => {
    const cached = getAuthState();
    if (cached) {
      return cached;
    }

    const result = await authClient.getSession();
    if (!result.data) {
      throw new Response("Unauthorized", { status: 401 });
    }

    return updateAuthState(result.data);
  },
});

function OrganizationLayoutRoute() {
  return <Outlet />;
}
