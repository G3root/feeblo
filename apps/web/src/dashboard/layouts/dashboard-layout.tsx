import { AppSidebar } from "~/components/common/app-sidebar";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { UpgradePlanDialogProvider } from "~/features/billing/dialog-stores";
import { CreateBoardDialog } from "~/features/board/components/create-board-dialog";
import { DeleteBoardDialog } from "~/features/board/components/delete-board-dialog";
import { RenameBoardDialog } from "~/features/board/components/rename-board-dialog";
import {
  CreateBoardDialogProvider,
  DeleteBoardDialogProvider,
  RenameBoardDialogProvider,
} from "~/features/board/dialog-stores";
import { PostCreateDialog } from "~/features/post/components/post-create-dialog";
import { PostDeleteDialog } from "~/features/post/components/post-delete-dialog";
import {
  PostCreateDialogProvider,
  PostDeleteDialogProvider,
} from "~/features/post/dialog-stores";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <UpgradePlanDialogProvider>
      <PostCreateDialogProvider>
        <RenameBoardDialogProvider>
          <DeleteBoardDialogProvider>
            <CreateBoardDialogProvider>
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
                      </div>
                    </header>

                    <ScrollArea className="min-h-0 flex-1 overflow-hidden">
                      {children}
                    </ScrollArea>
                  </SidebarInset>
                  <CreateBoardDialog />
                  <DeleteBoardDialog />
                  <RenameBoardDialog />
                  <PostDeleteDialog />
                  <PostCreateDialog />
                </SidebarProvider>
              </PostDeleteDialogProvider>
            </CreateBoardDialogProvider>
          </DeleteBoardDialogProvider>
        </RenameBoardDialogProvider>
      </PostCreateDialogProvider>
    </UpgradePlanDialogProvider>
  );
}
