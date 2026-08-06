import { useDashboardHomeStats } from "@feeblo/post-ui/dashboard/use-dashboard-home-stats";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@feeblo/ui/item";
import { Separator } from "@feeblo/ui/separator";
import { Skeleton } from "@feeblo/ui/skeleton";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { MessageMultiple01Icon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatPostDate } from "~/features/board/components/board-surface/utils";
import { useCreateBoardDialogContext } from "~/features/board/dialog-stores";
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

  const { boards, isError, isLoading, recentPosts, statuses, upvoteCounts } =
    useDashboardHomeStats({
      boardCollection,
      postCollection,
      postStatusCollection,
      upvoteCollection,
      organizationId,
    });

  const boardMap = new Map(boards.map((b) => [b.id, b]));
  const upvoteCountByPostId = new Map(
    upvoteCounts.map((entry) => [entry.postId, entry.count])
  );

  const userName =
    sessionData?.user?.name ?? sessionData?.user?.email ?? "there";

  let recentPostsSection: ReactNode;

  if (isLoading) {
    recentPostsSection = <RecentPostsSkeleton />;
  } else if (isError) {
    recentPostsSection = (
      <section>
        <h2 className="mb-3 font-medium text-muted-foreground text-sm">
          Recent posts
        </h2>
        <div className="flex min-h-32 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
          There was a problem loading your recent posts.
        </div>
      </section>
    );
  } else if (recentPosts.length > 0) {
    recentPostsSection = (
      <section>
        <h2 className="mb-3 font-medium text-muted-foreground text-sm">
          Recent posts
        </h2>
        <ItemGroup>
          {recentPosts.map((post) => {
            const board = boardMap.get(post.boardId);
            const status = statuses.find((s) => s.id === post.statusId);
            return (
              <Link
                className="block transition-transform duration-100 active:scale-[0.99]"
                key={post.id}
                params={{
                  organizationId,
                  boardSlug: board?.slug ?? "",
                  postSlug: post.slug,
                }}
                to="/$organizationId/post/$boardSlug/$postSlug"
              >
                <Item size="sm" variant="outline">
                  <ItemContent>
                    <ItemTitle>{post.title}</ItemTitle>
                    <ItemDescription>
                      {board?.name}
                      {board?.name && " · "}
                      {formatPostDate(post.createdAt)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {status && (
                      <Badge className="text-xs" variant="secondary">
                        {status.type
                          .toLowerCase()
                          .replace(/_/g, " ")
                          .replace(/\b\w/g, (c) => c.toUpperCase())}
                      </Badge>
                    )}
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {upvoteCountByPostId.get(post.id) ?? 0}
                    </span>
                  </ItemActions>
                </Item>
              </Link>
            );
          })}
        </ItemGroup>
      </section>
    );
  } else {
    const hasBoards = boards.length > 0;
    const emptyDescription = hasBoards
      ? "Create your first post to start collecting and organizing feedback from your users."
      : "Create your first board to start collecting posts and feedback.";
    const emptyCta = hasBoards ? (
      <Button
        onClick={() =>
          createPostStore.send({
            type: "toggle",
            data: { source: "dashboard", status: "PENDING" },
          })
        }
      >
        <HugeiconsIcon icon={Plus} />
        Create your first post
      </Button>
    ) : (
      <Button onClick={() => createBoardStore.send({ type: "toggle" })}>
        <HugeiconsIcon icon={Plus} />
        Create your first board
      </Button>
    );

    recentPostsSection = (
      <section>
        <h2 className="mb-3 font-medium text-muted-foreground text-sm">
          Recent posts
        </h2>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={MessageMultiple01Icon} />
            </EmptyMedia>
            <EmptyTitle>No posts yet</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{emptyCta}</EmptyContent>
        </Empty>
      </section>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl text-wrap-balance">
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

      {recentPostsSection}

      <Separator />

      <section>
        <p className="text-muted-foreground text-sm text-wrap-pretty">
          Have feedback? Share it at{" "}
          <a
            className="text-primary underline underline-offset-4 transition-colors duration-150 hover:text-primary/80"
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

function RecentPostsSkeleton() {
  return (
    <section>
      <h2 className="mb-3 font-medium text-muted-foreground text-sm">
        Recent posts
      </h2>
      <ItemGroup>
        {RECENT_POST_SKELETON_KEYS.map((key) => (
          <Item key={key} size="sm" variant="outline">
            <ItemContent>
              <ItemTitle>
                <Skeleton className="h-4 w-2/5" />
              </ItemTitle>
              <ItemDescription>
                <Skeleton className="h-3 w-1/3" />
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-6" />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}

const RECENT_POST_SKELETON_KEYS = ["a", "b", "c", "d", "e"];
