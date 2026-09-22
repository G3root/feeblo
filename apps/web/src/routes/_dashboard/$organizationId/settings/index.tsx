import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/$organizationId/settings/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$organizationId/settings/profile",
      params: { organizationId: params.organizationId },
    });
  },
});
