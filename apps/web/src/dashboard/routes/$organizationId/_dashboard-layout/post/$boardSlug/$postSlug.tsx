import { CommentsList } from "@feeblo/post-ui/comment-display";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@feeblo/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import {
  anyPolicy,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { CircleLockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatPostDate } from "~/features/board/components/board-surface/utils";
import { PostBoardField } from "~/features/post/components/post-board-field";
import { PostDetails } from "~/features/post/components/post-details-form";
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

  const { data: board } = useLiveQuery(
    (q) => {
      return q
        .from({ board: boardCollection })
        .where(({ board }) =>
          and(
            eq(board.slug, boardSlug),
            eq(board.organizationId, organizationId)
          )
        )
        .findOne();
    },
    [boardSlug, organizationId]
  );

  const boardId = board?.id;

  const { data: post } = useLiveQuery(
    (q) => {
      if (!boardId) {
        return undefined;
      }
      return q
        .from({ post: postCollection })
        .where(({ post }) =>
          and(
            eq(post.slug, postSlug),
            eq(post.organizationId, organizationId),
            eq(post.boardId, boardId)
          )
        )
        .findOne();
    },
    [postSlug, organizationId, boardId]
  );

  const postId = post?.id;

  const { allowed: canManagePost } = usePolicy(
    anyPolicy(
      hasOwnerOrAdminRole(organizationId),
      isUser(post?.creatorId ?? "")
    )
  );

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
              nativeButton={false}
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

  const isLocked = post.lockedAt !== null;

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_280px]">
      <PostDetails.Layout>
        <PostDetails.Header
          boardName={board.name}
          boardSlug={board.slug}
          organizationId={organizationId}
          postCreatorId={post.creatorId}
          postId={post.id}
          title={post.title}
        />
        <PostStatusAlerts lockedAt={post.lockedAt} />
        <PostDetails.Description
          description={post.content}
          organizationId={organizationId}
          postCreatorId={post.creatorId}
          postId={post.id}
        />
        <div className="flex items-center justify-between py-1">
          <PostDetails.EngagementBar disabled={isLocked} postId={post.id} />
        </div>
        <PostDetails.CommentComposer
          defaultVisibility="PUBLIC"
          disabled={isLocked}
          disabledReason="This post is locked, so new comments and notes are disabled until it is unlocked."
          postId={post.id}
          showVisibilityPicker
        />
        <CommentsList postId={post.id} />
      </PostDetails.Layout>

      <aside className="hidden px-6 py-6 lg:block">
        <div className="sticky top-0 space-y-4">
          <PostSidebarActions
            boardSlug={boardSlug}
            canManagePost={canManagePost}
            lockedAt={post.lockedAt}
            organizationId={organizationId}
            postId={post.id}
            postSlug={post.slug}
          />

          {canManagePost ? (
            <SidebarCard title="Properties">
              <div>
                <PostStatusSelect
                  currentStatusId={post.statusId}
                  postId={post.id}
                />
              </div>

              <PostBoardField
                currentBoardId={board.id}
                organizationId={organizationId}
                postId={post.id}
                postSlug={postSlug}
              />
            </SidebarCard>
          ) : null}

          <PostTagField organizationId={organizationId} postId={post.id} />

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
  );
}

function PostStatusAlerts({ lockedAt }: { lockedAt: Date | string | null }) {
  const isLocked = lockedAt !== null;

  if (!isLocked) {
    return null;
  }

  return (
    <Alert variant="info">
      <HugeiconsIcon icon={CircleLockIcon} />
      <AlertTitle>Locked post</AlertTitle>
      <AlertDescription>
        This post is locked, so members cannot continue interacting with it
        until it is unlocked.
      </AlertDescription>
    </Alert>
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
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
