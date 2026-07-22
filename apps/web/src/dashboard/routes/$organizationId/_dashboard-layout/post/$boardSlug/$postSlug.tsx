import { PostPage } from "@feeblo/post-ui/post-page";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Separator } from "@feeblo/ui/separator";
import {
  Calendar03Icon,
  CircleLockIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
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
              {(canManagePost) => (
                <>
                  <div>
                    <PostStatusSelect disabled={!canManagePost} />
                  </div>

                  <PostBoardField disabled={!canManagePost} />
                </>
              )}
            </PostPage.CanManage>

            <div>
              <Separator />
            </div>

            <PostTagField />

            <div>
              <Separator />
            </div>

            <PostDetails
              author={post.user?.name}
              createdAt={post.createdAt}
              updatedAt={post.updatedAt}
            />
          </div>
        </aside>
      </div>
    </PostPage.Root>
  );
}

function PostDetails({
  author,
  createdAt,
  updatedAt,
}: {
  author: string | null | undefined;
  createdAt: Date | string;
  updatedAt: Date | string;
}) {
  const details = [
    {
      icon: UserIcon,
      label: "Author",
      value: author ?? "Unknown author",
    },
    {
      icon: Calendar03Icon,
      label: "Created",
      value: formatPostDate(createdAt),
    },
    // {
    //   icon: Time02Icon,
    //   label: "Updated",
    //   value: formatPostDate(updatedAt),
    // },
  ];

  return (
    <section aria-labelledby="post-details-heading" className="space-y-2.5">
      <h2 className="sr-only" id="post-details-heading">
        Details
      </h2>
      <dl className="space-y-2">
        {details.map((detail) => (
          <div
            className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 text-xs"
            key={detail.label}
          >
            <HugeiconsIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground/72"
              icon={detail.icon}
              strokeWidth={1.75}
            />
            <dt className="text-muted-foreground">{detail.label}</dt>
            <dd className="max-w-32 truncate font-medium text-foreground">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
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
