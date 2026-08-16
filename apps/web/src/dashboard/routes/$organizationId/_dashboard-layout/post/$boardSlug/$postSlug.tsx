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
import { Skeleton } from "@feeblo/ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@feeblo/ui/tabs";
import * as dayjs from "@feeblo/utils/dayjs";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  Activity01Icon,
  Calendar03Icon,
  CircleLockIcon,
  Comment01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GitHubPostResourceActions } from "~/features/github/components/post-github-actions";
import { PostExternalResources } from "~/features/integrations/components/post-external-resources";
import { PostActivityList } from "~/features/post/components/post-activity-list";
import { PostBoardField } from "~/features/post/components/post-board-field";
import { PostEtaField } from "~/features/post/components/post-eta-field";
import { PostSidebarActions } from "~/features/post/components/post-sidebar-actions";
import { PostTagField } from "~/features/post/components/post-tag-field";
import { PostStatusSelect } from "~/features/post-status/components/post-status-select";
import {
  boardCollection,
  commentCollection,
  commentReactionCollection,
  postCollection,
  postReactionCollection,
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
      commentCollection.preload(),
      commentReactionCollection.preload(),
      postReactionCollection.preload(),
    ]);
  },
});

function RouteComponent() {
  const { organizationId, boardSlug, postSlug } = Route.useParams();
  const { boardCollection, postCollection } = useDashboardCollections();
  // The linked-resources panel and its GitHub actions are read/written through
  // RPCs that require integrations.manage, so gate them the same way the
  // settings route does instead of rendering actions that will 403.
  const githubResourcesPolicy = usePolicy(
    hasPermission(organizationId, "integrations.manage")
  );

  const { data: postRow, isLoading: isPostLoading } = useLiveQuery(
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

  // The post query is derived from the preloaded collections, but it still
  // passes through a brief `loading` phase on mount and post navigation.
  // Rendering the "Post not found" empty state then would flash the wrong
  // page (title, content and the reaction row unmount and remount), so show
  // a skeleton with the same layout while it resolves.
  if (isPostLoading) {
    return <PostPageSkeleton />;
  }

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

              <div className="flex items-center gap-2">
                <PostPage.Vote />
              </div>
            </div>
            <Tabs defaultValue="comments">
              <TabsList variant="underline">
                <TabsTab value="comments">
                  <HugeiconsIcon icon={Comment01Icon} />
                  Comments
                </TabsTab>
                <TabsTab value="activity">
                  <HugeiconsIcon icon={Activity01Icon} />
                  Activity
                </TabsTab>
              </TabsList>
              <TabsPanel className="space-y-6 pt-4" value="comments">
                <PostPage.DashboardCommentComposer />
                <PostPage.Comments />
              </TabsPanel>
              <TabsPanel className="pt-4" value="activity">
                <PostActivityList
                  organizationId={organizationId}
                  postId={post.id}
                />
              </TabsPanel>
            </Tabs>
          </section>
        </div>

        <aside className="px-6 py-6">
          <div className="space-y-4 lg:sticky lg:top-0">
            <PostSidebarActions />

            <div>
              <Separator />
            </div>

            {githubResourcesPolicy.isPending ||
            !githubResourcesPolicy.allowed ? null : (
              <PostExternalResources
                actions={
                  <GitHubPostResourceActions
                    organizationId={organizationId}
                    postId={post.id}
                  />
                }
                organizationId={organizationId}
                postId={post.id}
              />
            )}

            <div>
              <Separator />
            </div>

            {/* Each field self-gates with the permission the backend enforces
                (PostPolicy.canUpdateProperties): status → posts.status,
                board → posts.move, ETA → posts.status. */}
            <div>
              <PostStatusSelect />
            </div>

            <PostBoardField />

            <PostEtaField />

            <div>
              <Separator />
            </div>

            <PostTagField />

            <div>
              <Separator />
            </div>

            <PostDetails author={post.user?.name} createdAt={post.createdAt} />

            <div>
              <Separator />
            </div>

            <div className="flex flex-col gap-1.5">
              <h2 className="font-semibold text-sm">Subscribe to post</h2>
              <p className="text-pretty text-muted-foreground text-xs">
                Subscribe to receive future updates on the post by email
              </p>
            </div>

            <PostPage.Subscribe variant="default" />
          </div>
        </aside>
      </div>
    </PostPage.Root>
  );
}

function PostPageSkeleton() {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
        <section className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-7 w-2/3" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="flex items-center justify-between py-1">
            <Skeleton className="h-7 w-28 rounded-full" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-10 w-full" />
        </section>
      </div>
      <aside className="px-6 py-6">
        <Skeleton className="h-40 w-full" />
      </aside>
    </div>
  );
}

function PostDetails({
  author,
  createdAt,
}: {
  author: string | null | undefined;
  createdAt: Date | string;
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
      value: dayjs.default(createdAt).fromNow(),
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
