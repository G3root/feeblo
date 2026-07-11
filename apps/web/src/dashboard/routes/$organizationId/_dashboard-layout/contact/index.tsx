import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/contact/",
)({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/$organizationId/_dashboard-layout/contact/"!</div>
}
