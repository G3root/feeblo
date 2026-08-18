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
import { useCallback } from "react";

import { AppSidebar } from "~/components/common/app-sidebar";
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
  boardCollection,
  commentCollection,
  commentReactionCollection,
  membersCollection,
  postCollection,
  postReactionCollection,
  postStatusCollection,
  postSubscriptionCollection,
  upvoteCollection,
} from "~/lib/collections";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const organizationId = useOrganizationId();
  const getPostHref = useCallback<
    NonNullable<PostCollectionsValue["getPostHref"]>
  >(
    (post) => {
      const board = boardCollection.get(post.boardId);
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
          rpc.PostSuggestions({
            ...input,
            limit: 5,
            organizationId,
          }),
        { signal }
      ),
    [organizationId]
  );
  return (
    <UpgradePlanDialogProvider>
      <PostCollectionsProvider
        collections={{
          boardCollection,
          commentCollection,
          membersCollection,
          postCollection,
          postStatusCollection,
          postSubscriptionCollection,
          upvoteCollection,
          postReactionCollection,
          commentReactionCollection,
        }}
        getPostHref={getPostHref}
        organizationId={organizationId}
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
                            <SidebarProvider
                              className="h-dvh overflow-hidden"
                              style={
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
                                    <SidebarTrigger className="-ml-1" />
                                    <div className="ml-auto">
                                      <NotificationsMenu />
                                    </div>
                                  </div>
                                </header>

                                <ScrollArea
                                  className="min-h-0 flex-1 overflow-hidden"
                                  fill
                                >
                                  {children}
                                </ScrollArea>
                              </SidebarInset>
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
