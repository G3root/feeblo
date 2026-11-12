import { CommentDeleteDialog } from "@feeblo/post-ui/comment-delete-dialog";
import {
  CommentDeleteDialogProvider,
  PostCreateDialogProvider,
  PostDeleteDialogProvider,
} from "@feeblo/post-ui/dialog-stores";
import {
  PostCollectionsProvider,
  type PostCollectionsValue,
} from "@feeblo/post-ui/post-collections-provider";
import { PostCreateDialog } from "@feeblo/post-ui/post-create-dialog";
import { PostDeleteDialog } from "@feeblo/post-ui/post-delete-dialog";
import { ScrollArea } from "@feeblo/ui/scroll-area";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@feeblo/ui/sidebar";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { Link, useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { AppSidebar } from "~/components/common/app-sidebar";
import { MobileBottomSlotProvider } from "~/components/common/mobile-bottom-slot";
import { MobileNav } from "~/components/common/mobile-nav";
import { NotificationsMenu } from "~/components/common/notifications-menu";
import { UpgradePlanDialogProvider } from "~/features/billing/dialog-stores";
import { CreateBoardDialog } from "~/features/board/components/create-board-dialog";
import { DeleteBoardDialog } from "~/features/board/components/delete-board-dialog";
import { RenameBoardDialog } from "~/features/board/components/rename-board-dialog";
import {
  CreateBoardDialogProvider,
  DeleteBoardDialogProvider,
  RenameBoardDialogProvider,
} from "~/features/board/dialog-stores";
import { OverPlanBanner } from "~/features/plan-compliance/components/over-plan-banner";
import { CreateRoadmapDialog } from "~/features/roadmap/components/create-roadmap-dialog";
import { DeleteRoadmapDialog } from "~/features/roadmap/components/delete-roadmap-dialog";
import { EditRoadmapDialog } from "~/features/roadmap/components/edit-roadmap-dialog";
import { ToggleRoadmapVisibilityDialog } from "~/features/roadmap/components/toggle-roadmap-visibility-dialog";
import {
  CreateRoadmapDialogProvider,
  DeleteRoadmapDialogProvider,
  EditRoadmapDialogProvider,
  ToggleRoadmapVisibilityDialogProvider,
} from "~/features/roadmap/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";
import {
  dashboardCollections,
  dashboardCollectionsFor,
} from "~/lib/collections";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const organizationId = useOrganizationId();
  // Each collection is keyed by the scope it was materialized for. The layout
  // does not re-render for a child route on its own, and during a client-side
  // navigation `window.location` can still name the post being left while the
  // route already names the destination. Name the destination scope explicitly
  // so the provider never hands a target-filtered live query a source-scoped
  // collection.
  const postSlug = useParams({
    strict: false,
    select: (params) => params?.postSlug,
  });
  const collections = useMemo(() => {
    const scoped = dashboardCollectionsFor({ organizationId, postSlug });

    return {
      boardCollection: scoped.boardCollection,
      commentCollection: scoped.commentCollection,
      deleteEligibilityCollection: scoped.deleteEligibilityCollection,
      membersCollection: scoped.membersCollection,
      postCollection: scoped.postCollection,
      postDetailCollection: scoped.postDetailCollection,
      postStatusCollection: scoped.postStatusCollection,
      postSubscriptionCollection: scoped.postSubscriptionCollection,
      upvoteCollection: scoped.upvoteCollection,
      postReactionCollection: scoped.postReactionCollection,
      commentReactionCollection: scoped.commentReactionCollection,
    };
  }, [organizationId, postSlug]);
  const getPostHref = useCallback<
    NonNullable<PostCollectionsValue["getPostHref"]>
  >(
    (post) => {
      const board = dashboardCollections.boardCollection.get(post.boardId);
      return board
        ? `/${organizationId}/post/${board.slug}/${post.slug}`
        : `/${organizationId}`;
    },
    [organizationId]
  );
  const suggestPosts = useCallback<
    NonNullable<PostCollectionsValue["suggestPosts"]>
  >(
    ({ signal, ...input }) =>
      fetchRpc(
        (rpc) =>
          rpc.GetPostSuggestions({
            ...input,
            limit: 5,
            organizationId,
          }),
        { signal }
      ),
    [organizationId]
  );
  const persistPost = useCallback<PostCollectionsValue["persistPost"]>(
    async (input) => fetchRpc((rpc) => rpc.CreatePost(input)),
    []
  );
  return (
    <UpgradePlanDialogProvider>
      <PostCollectionsProvider
        collections={collections}
        getPostHref={getPostHref}
        organizationId={organizationId}
        persistPost={persistPost}
        suggestPosts={suggestPosts}
      >
        <PostCreateDialogProvider>
          <CommentDeleteDialogProvider>
            <RenameBoardDialogProvider>
              <DeleteBoardDialogProvider>
                <CreateBoardDialogProvider>
                  <CreateRoadmapDialogProvider>
                    <DeleteRoadmapDialogProvider>
                      <EditRoadmapDialogProvider>
                        <ToggleRoadmapVisibilityDialogProvider>
                          <PostDeleteDialogProvider>
                            <MobileBottomSlotProvider>
                              <SidebarProvider
                                // `DashboardPendingShell` unmounts in the same
                                // commit that mounts this shell, and it has no
                                // exit animation of its own, so the handoff is
                                // otherwise a hard cut. Fade instead: the
                                // loader already left the body background and
                                // the provider's `bg-sidebar` behind it, so the
                                // 200ms only moves the chrome and the page
                                // from transparent to resolved. Opacity alone —
                                // a viewport-sized element that translates
                                // would show the body through its edge — and a
                                // pure opacity change has no movement for
                                // `motion-reduce` to soften.
                                className="ease-out-strong h-dvh overflow-hidden transition-opacity duration-200 starting:opacity-0"
                                style={
                                  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                                  {
                                    "--sidebar-width":
                                      "calc(var(--spacing) * 72)",
                                    "--header-height":
                                      "calc(var(--spacing) * 12)",
                                  } as React.CSSProperties
                                }
                              >
                                <AppSidebar variant="inset" />
                                <SidebarInset className="h-full min-h-0 overflow-hidden">
                                  <header className="flex h-(--header-height) shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
                                    <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
                                      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
                                      <Link
                                        aria-label="Feeblo dashboard"
                                        className="-ml-1 rounded-md md:hidden"
                                        params={{ organizationId }}
                                        to="/$organizationId"
                                      >
                                        <img
                                          alt=""
                                          className="size-7 rounded-md"
                                          height={28}
                                          src="/favicon.svg"
                                          width={28}
                                        />
                                      </Link>
                                      <div className="ml-auto">
                                        <NotificationsMenu />
                                      </div>
                                    </div>
                                  </header>

                                  <OverPlanBanner />

                                  <ScrollArea
                                    className="min-h-0 flex-1 overflow-hidden max-md:pb-20"
                                    fill
                                  >
                                    {children}
                                  </ScrollArea>
                                </SidebarInset>
                                <MobileNav />
                                <CreateBoardDialog />
                                <CreateRoadmapDialog />
                                <DeleteRoadmapDialog />
                                <EditRoadmapDialog />
                                <ToggleRoadmapVisibilityDialog />
                                <DeleteBoardDialog />
                                <RenameBoardDialog />
                                <PostDeleteDialog />
                                <PostCreateDialog />
                                <CommentDeleteDialog />
                              </SidebarProvider>
                            </MobileBottomSlotProvider>
                          </PostDeleteDialogProvider>
                        </ToggleRoadmapVisibilityDialogProvider>
                      </EditRoadmapDialogProvider>
                    </DeleteRoadmapDialogProvider>
                  </CreateRoadmapDialogProvider>
                </CreateBoardDialogProvider>
              </DeleteBoardDialogProvider>
            </RenameBoardDialogProvider>
          </CommentDeleteDialogProvider>
        </PostCreateDialogProvider>
      </PostCollectionsProvider>
    </UpgradePlanDialogProvider>
  );
}
