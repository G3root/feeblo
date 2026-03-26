import {
  Delete02Icon,
  Edit,
  Ellipsis,
  Home,
  Megaphone03Icon,
  Plus,
  PreferenceVerticalIcon,
  SparklesIcon,
  WebDesign01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { Link, useRouterState } from "@tanstack/react-router";
import { Suspense } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "~/components/ui/sidebar";
import { Skeleton } from "~/components/ui/skeleton";
import { UpgradePlanDialog } from "~/features/billing/components/upgrade-dialog";
import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import {
  useCreateBoardDialogContext,
  useDeleteBoardDialogContext,
  useRenameBoardDialogContext,
} from "~/features/board/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { hasOwnerOrAdminRole, usePolicy } from "~/hooks/use-policy";
import { getPublicSiteUrl } from "~/hooks/use-site";
import { boardCollection } from "~/lib/collections";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { NavUser } from "./nav-user";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const organizationId = useOrganizationId();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <Suspense fallback={<WorkspaceSwitcherSkeleton />}>
          <WorkspaceSwitcher />
        </Suspense>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Overview</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === `/${organizationId}`}
                render={(props) => (
                  <Link
                    {...props}
                    params={{ organizationId }}
                    to="/$organizationId"
                  >
                    <HugeiconsIcon icon={Home} />
                    <span>Dashboard</span>
                  </Link>
                )}
              />
            </SidebarMenuItem>
            <MyBoardLink />
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname.startsWith(`/${organizationId}/changelog`)}
                render={(props) => (
                  <Link
                    {...props}
                    params={{ organizationId }}
                    to="/$organizationId/changelog"
                  >
                    <HugeiconsIcon icon={Megaphone03Icon} />
                    <span>Changelogs</span>
                  </Link>
                )}
              />
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname.startsWith(`/${organizationId}/settings`)}
                render={(props) => (
                  <Link
                    {...props}
                    params={{ organizationId }}
                    to="/$organizationId/settings/profile"
                  >
                    <HugeiconsIcon icon={PreferenceVerticalIcon} />
                    <span>Settings</span>
                  </Link>
                )}
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between">
            <SidebarGroupLabel>Boards</SidebarGroupLabel>
            <CreateBoardButton />
          </div>
          <SidebarMenu>
            <Suspense fallback={<BoardListSkeleton />}>
              <BoardList />
            </Suspense>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <UpgradePlanButton />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}

function CreateBoardButton() {
  const store = useCreateBoardDialogContext();

  return (
    <div>
      <SidebarMenuButton onClick={() => store.send({ type: "toggle" })}>
        <HugeiconsIcon className="size-4" icon={Plus} />
      </SidebarMenuButton>
    </div>
  );
}

function BoardList() {
  const organizationId = useOrganizationId();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { data } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ board: boardCollection })
        .where((board) => eq(board.board.organizationId, organizationId))

        .orderBy((board) => board.board.createdAt, "desc"),
    [organizationId]
  );

  return data.map((board) => (
    <SidebarMenuItem key={board.slug}>
      <SidebarMenuButton
        isActive={pathname.startsWith(`/${organizationId}/board/${board.slug}`)}
        render={(props) => (
          <Link
            {...props}
            params={{ organizationId, boardSlug: board.slug }}
            to="/$organizationId/board/$boardSlug"
          >
            <span>{board.name}</span>
          </Link>
        )}
      />
      <BoardMenuWithPolicy boardPublicId={board.id} />
    </SidebarMenuItem>
  ));
}

function WorkspaceSwitcherSkeleton() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex h-12 items-center gap-3 rounded-lg px-2">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function BoardListSkeleton() {
  return (
    <>
      <SidebarMenuSkeleton showIcon />
      <SidebarMenuSkeleton showIcon />
      <SidebarMenuSkeleton showIcon />
    </>
  );
}

interface BoardMenuProps {
  boardPublicId: string;
}

function BoardMenuWithPolicy({ boardPublicId }: BoardMenuProps) {
  const { allowed: canManageBoard } = usePolicy(hasOwnerOrAdminRole());
  if (!canManageBoard) {
    return null;
  }
  return <BoardMenu boardPublicId={boardPublicId} />;
}

function BoardMenu({ boardPublicId }: BoardMenuProps) {
  const { isMobile } = useSidebar();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props) => (
          <SidebarMenuAction {...props} showOnHover>
            <HugeiconsIcon icon={Ellipsis} />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        )}
      />

      <DropdownMenuContent
        align={isMobile ? "end" : "start"}
        className="w-48 rounded-lg"
        side={isMobile ? "bottom" : "right"}
      >
        <RenameBoardButton boardPublicId={boardPublicId} />

        <DropdownMenuSeparator />

        <DeleteBoardButton boardPublicId={boardPublicId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DeleteBoardButton = ({ boardPublicId }: { boardPublicId: string }) => {
  const store = useDeleteBoardDialogContext();

  return (
    <DropdownMenuItem
      onClick={() =>
        store.send({ type: "toggle", data: { boardId: boardPublicId } })
      }
    >
      <HugeiconsIcon className="text-muted-foreground" icon={Delete02Icon} />
      <span>Delete</span>
    </DropdownMenuItem>
  );
};

const RenameBoardButton = ({ boardPublicId }: { boardPublicId: string }) => {
  const store = useRenameBoardDialogContext();
  return (
    <DropdownMenuItem
      onClick={() =>
        store.send({ type: "toggle", data: { boardId: boardPublicId } })
      }
    >
      <HugeiconsIcon className="text-muted-foreground" icon={Edit} />
      <span>Rename</span>
    </DropdownMenuItem>
  );
};

function MyBoardLink() {
  const publicSiteUrl = getPublicSiteUrl();

  if (!publicSiteUrl) {
    return null;
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={(props) => (
          <a {...props} href={publicSiteUrl}>
            <HugeiconsIcon icon={WebDesign01Icon} />
            <span>My Board</span>
          </a>
        )}
      />
    </SidebarMenuItem>
  );
}

function UpgradePlanButton() {
  const store = useUpgradePlanDialogContext();
  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={() => store.send({ type: "toggle" })}>
          <HugeiconsIcon icon={SparklesIcon} />
          <span>Upgrade Plan</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <UpgradePlanDialog />
    </>
  );
}
