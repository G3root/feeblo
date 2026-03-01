import {
  Delete02Icon,
  Edit,
  Ellipsis,
  Home,
  Plus,
  PreferenceVerticalIcon,
  WebDesign01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "~/components/ui/sidebar";
import {
  useCreateBoardDialogContext,
  useDeleteBoardDialogContext,
  useRenameBoardDialogContext,
} from "~/features/board/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { getPublicSiteUrl } from "~/hooks/use-site";
import { boardCollection } from "~/lib/collections";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { OrganizationSwitcher } from "./organization-switcher";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const organizationId = useOrganizationId();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarSeparator />
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
            <MyBoardLink />
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between">
            <SidebarGroupLabel>Boards</SidebarGroupLabel>
            <CreateBoardButton />
          </div>
          <SidebarMenu>
            <BoardList />
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
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
    []
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
      <BoardMenu boardPublicId={board.id} />
    </SidebarMenuItem>
  ));
}

interface BoardMenuProps {
  boardPublicId: string;
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
