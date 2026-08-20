import { useDashboardHomeStats } from "@feeblo/post-ui/dashboard/use-dashboard-home-stats";
import { Button } from "@feeblo/ui/button";
import { Separator } from "@feeblo/ui/separator";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";

import { useCreateBoardDialogContext } from "~/features/board/dialog-stores";
import { RecentPostsSection } from "~/features/dashboard-home/components/recent-posts-section";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
  upvoteCollection,
} from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/_dashboard-layout/")({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      boardCollection.preload(),
      postCollection.preload(),
      postStatusCollection.preload(),
      upvoteCollection.preload(),
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
      boardCollection,
      postCollection,
      postStatusCollection,
      upvoteCollection,
      organizationId,
    });

  const userName =
    sessionData?.user?.name ?? sessionData?.user?.email ?? "there";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-wrap-balance text-2xl font-semibold">
          Hello, {userName}
        </h1>
        <div className="flex gap-2">
          <Button
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
            onClick={() => createBoardStore.send({ type: "toggle" })}
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Plus} />
            New board
          </Button>
        </div>
      </div>

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
