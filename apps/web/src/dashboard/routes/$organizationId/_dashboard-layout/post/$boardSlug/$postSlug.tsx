import { PostPage } from "@feeblo/post-ui/post-page";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { Card, CardPanel, CardHeader, CardTitle } from "@feeblo/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { CircleLockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatPostDate } from "~/features/board/components/board-surface/utils";
import { PostBoardField } from "~/features/post/components/post-board-field";
import { PostSidebarActions } from "~/features/post/components/post-sidebar-actions";
import { PostTagField } from "~/features/post/components/post-tag-field";
import { PostStatusSelect } from "~/features/post-status/components/post-status-select";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
  postTagCollection,
  tagCollection,
  upvoteCollection,
} from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/post/$boardSlug/$postSlug"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      boardCollection.preload(),
      postCollection.preload(),
      postStatusCollection.preload(),
      postTagCollection.preload(),
      tagCollection.preload(),
      upvoteCollection.preload(),
    ]);
  },
});

function RouteComponent() {
  const { organizationId, boardSlug, postSlug } = Route.useParams();
  const { boardCollection, postCollection } = useDashboardCollections();

  const { data: postRow } = useLiveQuery(
    (q) => {
      return q
        .from({ post: postCollection })

        .join(
          { board: boardCollection },
          ({ post, board }) => eq(post.boardId, board.id),
          "left"
        )
        .where(({ post }) =>
          and(eq(post.slug, postSlug), eq(post.organizationId, organizationId))
        )
        .findOne();
    },
    [organizationId, postSlug]
  );

  const board = postRow?.board;
  const post = postRow?.post;

  if (!(board && post)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Post not found</EmptyTitle>
          <EmptyDescription>
            We could not find the requested post.
          </EmptyDescription>
          <EmptyContent>
            <Button
              render={(props) => (
                <Link
                  {...props}
                  params={{ organizationId }}
                  to="/$organizationId"
                >
                  Go back to dashboard
                </Link>
              )}
              variant="link"
            />
          </EmptyContent>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <PostPage.Root
      board={board}
      organizationId={organizationId}
      pageType="Dashboard"
      post={post}
    >
      <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
          <section className="space-y-6">
            <div className="space-y-3">
              <Link
                className="inline-block text-muted-foreground text-xs underline-offset-4 hover:underline"
                params={{ organizationId, boardSlug }}
                to="/$organizationId/board/$boardSlug"
              >
                Back to {board.name}
              </Link>

              <PostPage.Title />
            </div>
            <PostStatusAlerts />
            <PostPage.Content />
            <div className="flex items-center justify-between py-1">
              <PostPage.Reactions />

              <PostPage.Vote />
            </div>
            <PostPage.DashboardCommentComposer />

            <PostPage.Comments />
          </section>
        </div>

        <aside className="hidden px-6 py-6 lg:block">
          <div className="sticky top-0 space-y-4">
            <PostSidebarActions />

            <PostPage.CanManage>
              <SidebarCard title="Properties">
                <div>
                  <PostStatusSelect />
                </div>

                <PostBoardField />
              </SidebarCard>
            </PostPage.CanManage>

            <PostTagField />

            <SidebarCard title="Details">
              <p className="text-muted-foreground text-sm">
                {formatPostDate(post.createdAt)}
              </p>

              <p className="text-muted-foreground text-sm">
                {post.user?.name ?? "Unknown author"}
              </p>
            </SidebarCard>
          </div>
        </aside>
      </div>
    </PostPage.Root>
  );
}

function PostStatusAlerts() {
  return (
    <PostPage.Locked>
      <Alert variant="info">
        <HugeiconsIcon icon={CircleLockIcon} />
        <AlertTitle>Locked post</AlertTitle>
        <AlertDescription>
          This post is locked, so members cannot continue interacting with it
          until it is unlocked.
        </AlertDescription>
      </Alert>
    </PostPage.Locked>
  );
}

function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">{children}</CardPanel>
    </Card>
  );
}
