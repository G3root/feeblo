import { createFileRoute, Outlet } from "@tanstack/react-router";
import { authClient, authStateCollection } from "~/lib/auth-client";
import { DashboardCollectionsProvider } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute("/$organizationId")({
  component: OrganizationLayoutRoute,
  beforeLoad: async () => {
    if (
      authStateCollection.get("auth") &&
      authStateCollection.get("auth")?.session.expiresAt > new Date()
    ) {
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      return authStateCollection.get("auth")!;
    }
    const result = await authClient.getSession();
    if (!result.data) {
      throw new Response("Unauthorized", { status: 401 });
    }
    authStateCollection.insert({ id: "auth", ...result.data });
    return result.data;
  },
});

function OrganizationLayoutRoute() {
  const { organizationId } = Route.useParams();

  return (
    <DashboardCollectionsProvider organizationId={organizationId}>
      <Outlet />
    </DashboardCollectionsProvider>
  );
}
