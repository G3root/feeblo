import { useDashboardHomeStats } from "@feeblo/post-ui/dashboard/use-dashboard-home-stats";
import { UpvoteId } from "@feeblo/id";
import { PostCard } from "@feeblo/post-ui/post/post-card";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Separator } from "@feeblo/ui/separator";
import { Skeleton } from "@feeblo/ui/skeleton";
import { cn } from "@feeblo/ui/utils";
import { getUpvoteCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  ArrowUp01Icon,
  MessageMultiple01Icon,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import NumberFlow from "@number-flow/react";

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

  const userName =
    sessionData?.user?.name ?? sessionData?.user?.email ?? "there";

  let recentPostsSection: ReactNode;

  if (isLoading) {
    recentPostsSection = <RecentPostsSkeleton />;
  } else if (isError) {
    recentPostsSection = (
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">
          Recent posts
        </h2>
        <div className="border-border/70 bg-muted/20 text-muted-foreground flex min-h-32 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
          There was a problem loading your recent posts.
        </div>
      </section>
    );
  } else if (recentPosts.length > 0) {
    recentPostsSection = (
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">
          Recent posts
        </h2>
        {/* Reuses feedback-page PostCard composably — no checkbox, layout mirrors public board with upvote */}
        <div className="divide-border/40 border-border/60 overflow-hidden rounded-xl border">
          {recentPosts.map((post) => {
            const board = boardMap.get(post.boardId);
            const status = statuses.find((s) => s.id === post.statusId);
            const user = (post as unknown as { user?: { image?: string | null; name?: string | null } }).user;
            const excerpt = (post as unknown as { excerpt?: string }).excerpt;
            const description =
              (excerpt && excerpt.trim().length > 0
                ? excerpt.length > 100
                  ? `${excerpt.slice(0, 99).trimEnd()}...`
                  : excerpt
                : "No details yet.") ||
              `${board?.name ?? ""}${board?.name ? " · " : ""}${formatPostDate(post.createdAt)}`;
            return (
              <PostCard.Root key={post.id}>
                <PostCard.Link
                  label={`View ${post.title}`}
                  params={{
                    organizationId,
                    boardSlug: board?.slug ?? "",
                    postSlug: post.slug,
                  }}
                  to="/$organizationId/post/$boardSlug/$postSlug"
                />
                <PostCard.Media>
                  <RecentPostUpvote organizationId={organizationId} postId={post.id} />
                </PostCard.Media>
                <PostCard.Body>
                  <PostCard.Title>{post.title}</PostCard.Title>
                  <PostCard.Description>{description}</PostCard.Description>
                  <PostCard.MobileMeta
                    boardName={board?.name ?? ""}
                    image={user?.image}
                    name={user?.name}
                  />
                </PostCard.Body>
                <PostCard.DesktopMeta>
                  {status && <PostCard.Status status={status.type} />}
                  {board?.name && <PostCard.BoardBadge>{board.name}</PostCard.BoardBadge>}
                  <PostCard.Author image={user?.image} name={user?.name} />
                </PostCard.DesktopMeta>
              </PostCard.Root>
            );
          })}
        </div>
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
        variant="brand"
      >
        <HugeiconsIcon icon={Plus} />
        Create your first post
      </Button>
    ) : (
      <Button
        onClick={() => createBoardStore.send({ type: "toggle" })}
        variant="brand"
      >
        <HugeiconsIcon icon={Plus} />
        Create your first board
      </Button>
    );

    recentPostsSection = (
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">
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

      {recentPostsSection}

      <Separator />

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

function RecentPostUpvote({
  organizationId,
  postId,
}: {
  organizationId: string;
  postId: string;
}) {
  const { data: session } = useAuthState();
  const { data: upvotes, isLoading: isUpvotesLoading } = useLiveQuery(
    (q) =>
      q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(eq(upvote.organizationId, organizationId), eq(upvote.postId, postId))
        ),
    [organizationId, postId]
  );
  const { data: hasUserUpvoted, isLoading: isUserUpvotedLoading } = useLiveQuery(
    (q) => {
      if (!session) return undefined;
      return q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId),
            eq(upvote.userId, session.user.id)
          )
        )
        .findOne();
    },
    [organizationId, postId, session?.user.id]
  );

  if (isUpvotesLoading || isUserUpvotedLoading) {
    return <Skeleton className="h-9 w-10 rounded-md" />;
  }

  const upvoteCount = upvotes?.length ?? 0;
  const isUpvoted = !!hasUserUpvoted;

  const handleToggle = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!session) return;
    const userId = session.user.id;
    const key = getUpvoteCollectionKey({ userId, postId });
    const hasUpvoted = upvoteCollection.has(key);
    if (hasUpvoted) {
      const tx = upvoteCollection.delete(key);
      await tx.isPersisted.promise;
    } else {
      const upvoteId = await UpvoteId.unsafeGenerate();
      const membership = session.memberships.find(
        (value) => value.organizationId === organizationId && value.userId === session.user.id
      );
      const tx = upvoteCollection.insert({
        id: upvoteId,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId,
        postId,
        userId,
        memberId: membership?.membershipId ?? null,
        user: { name: session.user.name ?? null, image: session.user.image ?? null },
      });
      await tx.isPersisted.promise;
    }
  };

  return (
    <button
      aria-label="Upvote"
      className={cn(
        "flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-md text-xs transition-colors",
        isUpvoted ? "bg-primary/10 text-primary" : "bg-muted/70 text-muted-foreground hover:bg-muted"
      )}
      data-slot="post-card-upvote"
      onClick={handleToggle}
      type="button"
    >
      <span className="flex items-center gap-1.5">
        <HugeiconsIcon className="size-3" icon={ArrowUp01Icon} />
        <NumberFlow className="text-xs leading-none font-medium tabular-nums" value={upvoteCount} willChange />
      </span>
    </button>
  );
}

function RecentPostsSkeleton() {
  return (
    <section>
      <h2 className="text-muted-foreground mb-3 text-sm font-medium">
        Recent posts
      </h2>
      <div className="divide-border/40 border-border/60 overflow-hidden rounded-xl border">
        {RECENT_POST_SKELETON_KEYS.map((key) => (
          <PostCard.Skeleton key={key} />
        ))}
      </div>
    </section>
  );
}

const RECENT_POST_SKELETON_KEYS = ["a", "b", "c", "d", "e"];
