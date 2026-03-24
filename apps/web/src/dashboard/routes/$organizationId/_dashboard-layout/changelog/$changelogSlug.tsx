import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/changelog/$changelogSlug"
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      Hello "/$organizationId/_dashboard-layout/changelog/$changelogSlug"!
    </div>
  );
}
