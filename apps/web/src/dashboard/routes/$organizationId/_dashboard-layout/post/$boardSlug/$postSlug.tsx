import { PostPage } from "@feeblo/post-ui/post-page";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Separator } from "@feeblo/ui/separator";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@feeblo/ui/tabs";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { Activity01Icon, Comment01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { GitHubPostResourceActions } from "~/features/github/components/post-github-actions";
import { PostExternalResources } from "~/features/integrations/components/post-external-resources";
import { PostStatusSelect } from "~/features/post-status/components/post-status-select";
import {
  createPostActivityQuery,
  PostActivityList,
} from "~/features/post/components/post-activity-list";
import { PostBoardField } from "~/features/post/components/post-board-field";
import { PostEtaField } from "~/features/post/components/post-eta-field";
import { PostSidebarActions } from "~/features/post/components/post-sidebar-actions";
import { PostTagField } from "~/features/post/components/post-tag-field";
import {
  boardCollection,
  commentCollection,
  commentReactionCollection,
  postCollection,
  postReactionCollection,
  postStatusCollection,
  postSubscriptionCollection,
  postTagCollection,
  tagCollection,
  upvoteCollection,
} from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  PostPageSkeleton,
  PostDetails,
  PostStatusAlerts,
} from "./post-page-parts";

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
      postSubscriptionCollection.preload(),
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
  const activityQuery = useMemo(
    () =>
      createPostActivityQuery({
        organizationId,
        postId: post?.id ?? "",
      }),
    [organizationId, post?.id]
  );

  const preloadActivity = () => {
    activityQuery.preload();
  };

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
                className="text-muted-foreground inline-block text-xs underline-offset-4 hover:underline"
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
                <TabsTab
                  onMouseEnter={preloadActivity}
                  onFocus={preloadActivity}
                  value="activity"
                >
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
                  activityQuery={activityQuery}
                  organizationId={organizationId}
                />
              </TabsPanel>
            </Tabs>
          </section>
        </div>

        <aside className="px-6 py-6">
          <div className="space-y-4 lg:sticky lg:top-0">
            <PostSidebarActions />

            {githubResourcesPolicy.isPending ||
            !githubResourcesPolicy.allowed ? null : (
              <>
                <div>
                  <Separator />
                </div>

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
              </>
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

            <PostPage.Subscribe />
          </div>
        </aside>
      </div>
    </PostPage.Root>
  );
}
