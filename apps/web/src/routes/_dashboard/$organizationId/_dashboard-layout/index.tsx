import { useDashboardHomeStats } from "@feeblo/post-ui/dashboard/use-dashboard-home-stats";
import { Button } from "@feeblo/ui/button";
import { Separator } from "@feeblo/ui/separator";
import {
  SpeedDial,
  SpeedDialAction,
  SpeedDialContent,
  SpeedDialItem,
  SpeedDialLabel,
  SpeedDialTrigger,
} from "@feeblo/ui/speed-dial";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  DashboardSquareAddIcon,
  MessageAdd01Icon,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";

import { useCreateBoardDialogContext } from "~/features/board/dialog-stores";
import { RecentPostsSection } from "~/features/dashboard-home/components/recent-posts-section";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { dashboardCollections } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      dashboardCollections.boardCollection.preload(),
      dashboardCollections.postCollection.preload(),
      dashboardCollections.postStatusCollection.preload(),
      dashboardCollections.upvoteCollection.preload(),
    ]);

    return null;
  },
});

function RouteComponent() {
  const organizationId = useOrganizationId();
  const { data: sessionData } = useAuthState();
  const createPostStore = usePostCreateDialogContext();
  const createBoardStore = useCreateBoardDialogContext();

  const { boards, isError, isLoading, recentPosts, statuses } =
    useDashboardHomeStats({
      boardCollection: dashboardCollections.boardCollection,
      postCollection: dashboardCollections.postCollection,
      postStatusCollection: dashboardCollections.postStatusCollection,
      upvoteCollection: dashboardCollections.upvoteCollection,
      organizationId,
    });

  const userName =
    sessionData?.user?.name ?? sessionData?.user?.email ?? "there";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-wrap-balance text-2xl font-semibold">
          Hello, {userName}
        </h1>
        <div className="hidden gap-2 md:flex">
          <Button
            className="flex-1 sm:flex-none"
            onClick={() =>
              createPostStore.send({
                type: "toggle",
                data: { source: "dashboard", status: "PENDING" },
              })
            }
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Plus} />
            New post
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            onClick={() => createBoardStore.send({ type: "toggle" })}
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Plus} />
            New board
          </Button>
        </div>
      </div>

      <SpeedDial
        className="fixed right-4 bottom-[max(calc(var(--spacing)*4),env(safe-area-inset-bottom))] z-40 md:hidden"
        side="top"
      >
        <SpeedDialTrigger aria-label="Create">
          <HugeiconsIcon
            className="transition-transform duration-500 ease-[cubic-bezier(0.68,-0.6,0.32,1.6)] in-[[aria-expanded=true]]:rotate-[135deg] motion-reduce:transition-none"
            icon={Plus}
          />
        </SpeedDialTrigger>
        <SpeedDialContent>
          <SpeedDialItem>
            <SpeedDialLabel>New post</SpeedDialLabel>
            <SpeedDialAction
              aria-label="New post"
              onClick={() =>
                createPostStore.send({
                  type: "toggle",
                  data: { source: "dashboard", status: "PENDING" },
                })
              }
            >
              <HugeiconsIcon icon={MessageAdd01Icon} />
            </SpeedDialAction>
          </SpeedDialItem>
          <SpeedDialItem>
            <SpeedDialLabel>New board</SpeedDialLabel>
            <SpeedDialAction
              aria-label="New board"
              onClick={() => createBoardStore.send({ type: "toggle" })}
            >
              <HugeiconsIcon icon={DashboardSquareAddIcon} />
            </SpeedDialAction>
          </SpeedDialItem>
        </SpeedDialContent>
      </SpeedDial>

      {/* Recent posts */}
      <RecentPostsSection
        boards={boards}
        isError={isError}
        isLoading={isLoading}
        organizationId={organizationId}
        recentPosts={recentPosts}
        statuses={statuses}
      />

      <Separator />

      {/* Feedback prompt */}
      <section>
        <p className="text-muted-foreground text-wrap-pretty text-sm">
          Have feedback? Share it at{" "}
          <a
            className="text-primary hover:text-primary/80 underline underline-offset-4 transition-colors duration-150"
            href="https://feedback.feeblo.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            feedback.feeblo.com
          </a>
        </p>
      </section>
    </div>
  );
}
