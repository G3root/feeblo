import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { dashboardBoards } from "~/lib/mock-data";

export const Route = createFileRoute("/$organizationId/_dashboard-layout/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();
  const boardCount = dashboardBoards.length;
  const postCount = dashboardBoards.reduce(
    (total, board) => total + board.posts.length,
    0
  );
  const inProgressCount = dashboardBoards.reduce(
    (total, board) =>
      total +
      board.posts.filter((post) => post.status === "IN_PROGRESS").length,
    0
  );

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

      <section className="grid gap-4 md:grid-cols-2">
        {dashboardBoards.map((board) => (
          <Card key={board.slug}>
            <CardHeader>
              <CardDescription>{board.description}</CardDescription>
              <CardTitle>{board.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">
                {board.posts.length} post{board.posts.length === 1 ? "" : "s"}
              </span>
              <Badge
                variant={
                  board.visibility === "PUBLIC" ? "default" : "secondary"
                }
              >
                {board.visibility}
              </Badge>
            </CardContent>
            <CardFooter className="justify-end">
              <Link
                className={buttonVariants({ size: "sm" })}
                params={{ organizationId, boardSlug: board.slug }}
                to="/$organizationId/board/$boardSlug"
              >
                Open board
              </Link>
            </CardFooter>
          </Card>
        ))}
      </section>
    </div>
  );
}
