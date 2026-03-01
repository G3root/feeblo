import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export const Route = createFileRoute("/$organizationId/_dashboard-layout/")({
  component: RouteComponent,
});

function RouteComponent() {
  const boardCount = 10;
  const postCount = 100;
  const inProgressCount = 10;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total boards</CardDescription>
            <CardTitle>{boardCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total posts</CardDescription>
            <CardTitle>{postCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>In progress</CardDescription>
            <CardTitle>{inProgressCount}</CardTitle>
          </CardHeader>
        </Card>
      </section>
    </div>
  );
}
