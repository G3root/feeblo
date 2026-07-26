import { CommentDeleteDialog } from "@feeblo/post-ui/comment-delete-dialog";
import {
  CommentDeleteDialogProvider,
  PostCreateDialogProvider,
  PostDeleteDialogProvider,
} from "@feeblo/post-ui/dialog-stores";
import { PostCollectionsProvider } from "@feeblo/post-ui/post-collections-provider";
import { PostCreateDialog } from "@feeblo/post-ui/post-create-dialog";
import { PostDeleteDialog } from "@feeblo/post-ui/post-delete-dialog";
import { ScrollArea } from "@feeblo/ui/scroll-area";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@feeblo/ui/sidebar";
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
import {
  CreateRoadmapDialogProvider,
  DeleteRoadmapDialogProvider,
  EditRoadmapDialogProvider,
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
  upvoteCollection,
} from "~/lib/collections";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const organizationId = useOrganizationId();
  return (
    <UpgradePlanDialogProvider>
      <PostCollectionsProvider
        collections={{
          boardCollection,
          commentCollection,
          membersCollection,
          postCollection,
          postStatusCollection,
          upvoteCollection,
          postReactionCollection,
          commentReactionCollection,
        }}
        organizationId={organizationId}
      >
        <PostCreateDialogProvider>
          <CommentDeleteDialogProvider>
            <RenameBoardDialogProvider>
              <DeleteBoardDialogProvider>
                <CreateBoardDialogProvider>
                  <CreateRoadmapDialogProvider>
                    <DeleteRoadmapDialogProvider>
                      <EditRoadmapDialogProvider>
                        <PostDeleteDialogProvider>
                          <SidebarProvider
                            className="h-dvh overflow-hidden"
                            style={
                              {
                                "--sidebar-width": "calc(var(--spacing) * 72)",
                                "--header-height": "calc(var(--spacing) * 12)",
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

                              <ScrollArea className="min-h-0 flex-1 overflow-hidden">
                                {children}
                              </ScrollArea>
                            </SidebarInset>
                            <CreateBoardDialog />
                            <CreateRoadmapDialog />
                            <DeleteRoadmapDialog />
                            <EditRoadmapDialog />
                            <DeleteBoardDialog />
                            <RenameBoardDialog />
                            <PostDeleteDialog />
                            <PostCreateDialog />
                            <CommentDeleteDialog />
                          </SidebarProvider>
                        </PostDeleteDialogProvider>
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
