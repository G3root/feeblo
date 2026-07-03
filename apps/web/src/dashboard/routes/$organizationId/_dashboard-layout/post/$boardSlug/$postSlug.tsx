import { CommentDeleteDialog } from "@feeblo/post-ui/comment-delete-dialog";
import { CommentsList } from "@feeblo/post-ui/comment-display";
import {
  CommentDeleteDialogProvider,
  PostDeleteDialogProvider,
} from "@feeblo/post-ui/dialog-stores";
import {
  PostCollectionDataProvider,
  usePostCollectionData,
} from "@feeblo/post-ui/post-collection";
import { PostCommentComposer } from "@feeblo/post-ui/post-comment-composer";
import { PostDeleteDialog } from "@feeblo/post-ui/post-delete-dialog";
import { PostContentUpdateInput } from "@feeblo/post-ui/post-editor";
import { PostTitleUpdateInput } from "@feeblo/post-ui/post-title-input";
import { PostReactionPicker } from "@feeblo/post-ui/reaction-picker";
import { UpvoteButton } from "@feeblo/post-ui/upvote-toggle";
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

  return (
    <PostDeleteDialogProvider>
      <CommentDeleteDialogProvider>
        <PostCollectionDataProvider
          board={board}
          organizationId={organizationId}
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

                  <PostTitleUpdateInput />
                </div>
                <PostStatusAlerts />
                <PostContentUpdateInput />
                <div className="flex items-center justify-between py-1">
                  <PostReactionPicker />

                  <UpvoteButton />
                </div>
                <PostCommentComposer />

                <CommentsList />
              </section>
            </div>

            <aside className="hidden px-6 py-6 lg:block">
              <div className="sticky top-0 space-y-4">
                <PostSidebarActions />

                {canManagePost ? (
                  <SidebarCard title="Properties">
                    <div>
                      <PostStatusSelect />
                    </div>

                    <PostBoardField />
                  </SidebarCard>
                ) : null}

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
          <PostDeleteDialog />
          <CommentDeleteDialog />
        </PostCollectionDataProvider>
      </CommentDeleteDialogProvider>
    </PostDeleteDialogProvider>
  );
}

function PostStatusAlerts() {
  const { isLocked } = usePostCollectionData();

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
