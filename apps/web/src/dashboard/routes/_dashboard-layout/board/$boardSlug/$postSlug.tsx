import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_dashboard-layout/board/$boardSlug/$postSlug"
)({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_dashboard-layout/board/$boardSlug/$postSlug"!</div>;
}
