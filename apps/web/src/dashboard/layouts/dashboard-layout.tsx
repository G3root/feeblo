import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "~/components/common/app-sidebar";
import { buttonVariants } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { CreateBoardDialog } from "~/features/board/components/create-board-dialog";
import { DeleteBoardDialog } from "~/features/board/components/delete-board-dialog";
import { RenameBoardDialog } from "~/features/board/components/rename-board-dialog";
import {
  CreateBoardDialogProvider,
  DeleteBoardDialogProvider,
  RenameBoardDialogProvider,
} from "~/features/board/dialog-stores";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const organizationId = useParams({ strict: false }).organizationId as string;
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  let pageTitle = "Workspace";
  if (pathname === `/${organizationId}`) {
    pageTitle = "Dashboard";
  } else if (pathname.startsWith(`/${organizationId}/board/`)) {
    pageTitle = "Board";
  }

  return (
    <RenameBoardDialogProvider>
      <DeleteBoardDialogProvider>
        <CreateBoardDialogProvider>
          <SidebarProvider className="h-dvh overflow-hidden">
            <AppSidebar />
            <SidebarInset className="h-full min-h-0 overflow-hidden md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none">
              <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
                <div className="flex items-center gap-2">
                  <SidebarTrigger className="-ml-1" />
                  <h1 className="font-semibold text-sm tracking-tight">
                    {pageTitle}
                  </h1>
                </div>
                <Link
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                  to="/sign-in"
                >
                  Sign in
                </Link>
              </header>

              <ScrollArea className="min-h-0 flex-1 overflow-hidden">
                {children}
              </ScrollArea>
            </SidebarInset>
            <CreateBoardDialog />
            <DeleteBoardDialog />
            <RenameBoardDialog />
          </SidebarProvider>
        </CreateBoardDialogProvider>
      </DeleteBoardDialogProvider>
    </RenameBoardDialogProvider>
  );
}
