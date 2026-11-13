import { useAtomSet } from "@effect/atom-react";
import { asLegid, CommentId, PostId } from "@feeblo/id";
import type { BanAuthorTarget } from "@feeblo/post-ui/dialog-stores";
import { PostPage } from "@feeblo/post-ui/post-page";
import type { UserBanActions } from "@feeblo/post-ui/post-page-context";
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
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  Activity01Icon,
  ChartLineData01Icon,
  Comment01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";

import {
  GitHubPostIssueDialog,
  GitHubPostResourceActions,
} from "~/features/github/components/post-github-actions";
import type { GitHubPostIssueAction } from "~/features/github/shared-form";
import { PostExternalResources } from "~/features/integrations/components/post-external-resources";
import {
  createPostActivityQuery,
  PostActivityList,
} from "~/features/post/components/post-activity-list";
import { PostMergedAlert } from "~/features/post/components/post-merged-alert";
import { PostMergedPosts } from "~/features/post/components/post-merged-posts";
import {
  PostPageSkeleton,
  PostDetails,
  PostStatusAlerts,
} from "~/features/post/components/post-page-sections";
import { PostSidebarActions } from "~/features/post/components/post-sidebar-actions";
import { PostTagField } from "~/features/post/components/post-tag-field";
import { PostViews } from "~/features/post/components/post-views";
import { postTrafficQueryOptions } from "~/features/post/lib/post-traffic-query";
import {
  banUserAtom,
  unbanUserAtom,
  userBanReactivityKeys,
} from "~/features/user-ban/atoms";
import { useEntitlements } from "~/hooks/use-entitlements";
import { preloadPostDetail } from "~/lib/preloads";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/post/$boardSlug/$postSlug"
)({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    await preloadPostDetail({
      organizationId: params.organizationId,
      postSlug: params.postSlug,
    });
  },
});

/**
 * A GitHub issue dialog request, paired with the post it was opened for.
 *
 * The route component survives post navigation, so the post id travels with
 * the action: a dialog can only ever submit against the post that opened it.
 */
type GitHubIssueDialog = {
  readonly action: GitHubPostIssueAction;
  readonly postId: string;
};

/**
 * post-ui names a participation row with the plain ids it renders; the RPC
 * schema brands them.
 */
const toUserBanTarget = (target: BanAuthorTarget) =>
  target._tag === "comment"
    ? {
        _tag: "comment" as const,
        commentId: asLegid(CommentId)(target.commentId),
      }
    : { _tag: "post" as const, postId: asLegid(PostId)(target.postId) };

// The analytics tab is its own chunk: the post's first load should not carry
// the breakdown UI for a tab the reader may never open.
const LazyPostAnalytics = lazy(() =>
  import("~/features/post/components/post-analytics").then((module) => ({
    default: module.PostAnalytics,
  }))
);

function RouteComponent() {
  const { organizationId, boardSlug, postSlug } = Route.useParams();
  const { boardCollection, postCollection } = useDashboardCollections();
  const queryClient = useQueryClient();
  // The linked-resources panel and its GitHub actions are read/written through
  // RPCs that require integrations.manage, so gate them the same way the
  // settings route does instead of rendering actions that will 403.
  const githubResourcesPolicy = usePolicy(
    hasPermission(organizationId, "integrations.manage")
  );
  // Banning a comment or post author is a manager action behind the paid plan
  // gate. Lifting a ban is the same permission with no plan gate, so a workspace
  // that downgrades can still clear the bans it kept. The server enforces the
  // permission on both, and the plan only on the write. The actions wait for the
  // entitlements read: while it is loading the capability is unknown, and
  // showing a ban button the plan may not cover is worse than a frame of nothing.
  const { entitlements, isLoading: isEntitlementsLoading } = useEntitlements();
  const { allowed: canManageUserBans } = usePolicy(
    hasPermission(organizationId, "userBans.manage")
  );
  const canBanAuthors =
    canManageUserBans &&
    !isEntitlementsLoading &&
    entitlements.capabilities.userBans;
  // Ban and unban go through the ban atoms rather than a bare RPC: the atoms
  // bump the reactivity key the security settings list is cached under, so
  // writing from here cannot leave that list — or the badges it agrees with —
  // showing the previous answer.
  const banUser = useAtomSet(banUserAtom, { mode: "promise" });
  const unbanUser = useAtomSet(unbanUserAtom, { mode: "promise" });
  const userBanActions = useMemo<UserBanActions>(
    () => ({
      ban: (input) =>
        banUser({
          payload: {
            deleteContent: input.deleteContent,
            organizationId,
            target: toUserBanTarget(input.target),
            ...(input.reason === undefined
              ? undefined
              : { reason: input.reason }),
          },
          reactivityKeys: userBanReactivityKeys(organizationId),
        }),
      unban: async (input) => {
        await unbanUser({
          payload: {
            _tag: "author",
            organizationId,
            target: toUserBanTarget(input.target),
          },
          reactivityKeys: userBanReactivityKeys(organizationId),
        });
      },
    }),
    [banUser, organizationId, unbanUser]
  );
  // The dialog lives here rather than inside the linked-resource menu: a menu
  // item click closes (and unmounts) the popup, so a dialog mounted in the
  // actions node would disappear with it.
  const [githubIssueDialog, setGithubIssueDialog] =
    useState<GitHubIssueDialog | null>(null);

  const { data: postRow, isLoading: isPostLoading } = useLiveQuery({
    queryKey: [
      "post-by-slug-with-board",
      postCollection.id,
      boardCollection.id,
      postSlug,
      organizationId,
    ],
    query: (q) => {
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
  });

  const board = postRow?.board;
  const post = postRow?.post;
  // Drop a dialog opened on another post (or while the next one loads) so it
  // cannot outlive the post it belongs to.
  if (githubIssueDialog !== null && githubIssueDialog.postId !== post?.id) {
    setGithubIssueDialog(null);
  }
  const activityQuery = useMemo(
    () =>
      createPostActivityQuery({
        organizationId,
        postId: post?.id ?? "",
      }),
    [organizationId, post?.id]
  );

  const preloadActivity = () => activityQuery.preload();

  // The post query is derived from the preloaded collections, but it still
  // passes through a brief `loading` phase on mount and post navigation.
  // Rendering the "Post not found" empty state then would flash the wrong
  // page (title, content and the reaction row unmount and remount), so show
  // a skeleton with the same layout while it resolves.
  // (The body itself streams in through the detail collection inside
  // `PostPage.Content`, so it never blocks this shell.)
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

  // A merged post is a read-only tombstone: its votes, reactions, and voters
  // live on the survivor now, so those panels would show a misleading subset.
  const isMerged = post.mergedIntoPostId != null;

  // Warm both halves of the tab on intent: the chunk and the read. The
  // panel's `useQuery` then joins the request instead of starting one.
  const preloadAnalytics = () => {
    void import("~/features/post/components/post-analytics");
    void queryClient.prefetchQuery(
      postTrafficQueryOptions({ organizationId, postId: post.id })
    );
  };

  return (
    <PostPage.Root
      board={board}
      canBanAuthors={canBanAuthors}
      canUnbanAuthors={canManageUserBans}
      organizationId={organizationId}
      pageType="Dashboard"
      post={post}
      userBanActions={userBanActions}
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
            <PostMergedAlert />
            <PostPage.Content />
            <PostMergedPosts />
            <div className="flex items-center justify-between py-1">
              {isMerged ? (
                <p className="text-muted-foreground text-sm">
                  Votes and reactions moved to the surviving post.
                </p>
              ) : (
                <>
                  <PostPage.Reactions />

                  <div className="flex items-center gap-2">
                    <PostPage.Vote />
                  </div>
                </>
              )}
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
                <TabsTab
                  onMouseEnter={preloadAnalytics}
                  onFocus={preloadAnalytics}
                  value="analytics"
                >
                  <HugeiconsIcon icon={ChartLineData01Icon} />
                  Analytics
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
              <TabsPanel className="pt-4" value="analytics">
                <Suspense
                  fallback={
                    <div className="grid gap-3 md:grid-cols-2">
                      <Skeleton className="h-36 rounded-xl" />
                      <Skeleton className="h-36 rounded-xl" />
                      <Skeleton className="h-36 rounded-xl" />
                      <Skeleton className="h-36 rounded-xl" />
                    </div>
                  }
                >
                  <LazyPostAnalytics
                    organizationId={organizationId}
                    postId={post.id}
                  />
                </Suspense>
              </TabsPanel>
            </Tabs>
          </section>
        </div>

        <aside className="px-4 py-6 md:px-6">
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
                      onSelectAction={(action) =>
                        setGithubIssueDialog({ action, postId: post.id })
                      }
                      organizationId={organizationId}
                    />
                  }
                  organizationId={organizationId}
                  postId={post.id}
                />

                {githubIssueDialog === null ? null : (
                  <GitHubPostIssueDialog
                    action={githubIssueDialog.action}
                    onOpenChange={(open) => {
                      if (!open) {
                        setGithubIssueDialog(null);
                      }
                    }}
                    organizationId={organizationId}
                    postId={githubIssueDialog.postId}
                  />
                )}
              </>
            )}

            <div>
              <Separator />
            </div>

            {/* Each field self-gates with the permission the backend enforces
                (PostPolicy.canUpdateProperties): status → posts.status,
                board → posts.move, ETA → posts.status, assignee →
                posts.status. */}
            <PostDetails createdAt={post.createdAt}>
              <PostViews organizationId={organizationId} postId={post.id} />
            </PostDetails>

            {/* Voter management: add/remove on behalf of customers.
                Controls self-gate with `votes.onBehalf` (contributor+).
                Hidden on a merged tombstone: the votes still on this post are
                only the ones that collided with the survivor's, so the panel
                would misrepresent who backed it. */}
            {isMerged ? null : <PostPage.Voters />}

            <div>
              <Separator />
            </div>

            <PostTagField />

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
