import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
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
  useSidebar,
} from "@feeblo/ui/sidebar";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { hasOwnerOrAdminRole, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  Building06Icon,
  Delete02Icon,
  Edit,
  Ellipsis,
  Home,
  InternetIcon,
  LayoutThreeColumnIcon,
  Megaphone03Icon,
  MessageMultiple01Icon,
  Plus,
  PreferenceVerticalIcon,
  SparklesIcon,
  Users,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link, useRouterState } from "@tanstack/react-router";
import { UpgradePlanDialog } from "~/features/billing/components/upgrade-dialog";
import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import {
  useCreateBoardDialogContext,
  useDeleteBoardDialogContext,
  useRenameBoardDialogContext,
} from "~/features/board/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { getPublicSiteUrl } from "~/hooks/use-site";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
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
        <WorkspaceSwitcher />
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

        <SidebarGroup>
          <SidebarGroupLabel>Modules</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname.startsWith(`/${organizationId}/feedback`)}
                render={(props) => (
                  <Link
                    {...props}
                    params={{ organizationId }}
                    to="/$organizationId/feedback"
                  >
                    <HugeiconsIcon icon={MessageMultiple01Icon} />
                    <span>Feedback</span>
                  </Link>
                )}
              />
            </SidebarMenuItem>
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
                    <span>Changelog</span>
                  </Link>
                )}
              />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname.startsWith(`/${organizationId}/roadmap`)}
                render={(props) => (
                  <Link
                    {...props}
                    params={{ organizationId }}
                    to="/$organizationId/roadmap"
                  >
                    <HugeiconsIcon icon={LayoutThreeColumnIcon} />
                    <span>Roadmap</span>
                  </Link>
                )}
              />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname.startsWith(`/${organizationId}/contact`)}
                render={(props) => (
                  <Link
                    {...props}
                    params={{ organizationId }}
                    to="/$organizationId/contact"
                  >
                    <HugeiconsIcon icon={Users} />
                    <span>Contacts</span>
                  </Link>
                )}
              />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname.startsWith(`/${organizationId}/company`)}
                render={(props) => (
                  <Link
                    {...props}
                    params={{ organizationId }}
                    to="/$organizationId/company"
                  >
                    <HugeiconsIcon icon={Building06Icon} />
                    <span>Companies</span>
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
            <BoardList />
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
      <SidebarMenuButton
        aria-label="Create board"
        onClick={() => store.send({ type: "toggle" })}
        size="sm"
      >
        <HugeiconsIcon icon={Plus} />
      </SidebarMenuButton>
    </div>
  );
}

function BoardList() {
  const organizationId = useOrganizationId();
  const { boardCollection } = useDashboardCollections();

  const boardQuery = useLiveQuery(
    (q) =>
      q
        .from({ board: boardCollection })
        .where((board) => eq(board.board.organizationId, organizationId))

        .orderBy((board) => board.board.createdAt, "desc"),
    [organizationId]
  );

  if (boardQuery.isLoading) {
    return (
      <SkeletonLoader isLoading>
        {Array.from({ length: 2 }, (_, index) => (
          <BoardItem
            boardPublicId={`board-id-${index}`}
            boardSlug={`board-slug-${index}`}
            key={`board-skeleton-${
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders are static.
              index
            }`}
            name="Loading"
          />
        ))}
      </SkeletonLoader>
    );
  }

  return (
    <SkeletonLoader isLoading={false}>
      {boardQuery.data.map((board) => (
        <BoardItem
          boardPublicId={board.id}
          boardSlug={board.slug}
          key={board.id}
          name={board.name}
        />
      ))}
    </SkeletonLoader>
  );
}

interface BoardItemProp {
  boardPublicId: string;
  boardSlug: string;
  name: string;
}

function BoardItem({
  boardPublicId,
  name,

  boardSlug,
}: BoardItemProp) {
  const organizationId = useOrganizationId();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <SkeletonWrapper>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={pathname.startsWith(
            `/${organizationId}/board/${boardSlug}`
          )}
          render={(props) => (
            <Link
              params={{ organizationId, boardSlug }}
              to="/$organizationId/board/$boardSlug"
              {...props}
            >
              <span>{name}</span>
            </Link>
          )}
        />
        <BoardMenuWithPolicy boardPublicId={boardPublicId} />
      </SidebarMenuItem>
    </SkeletonWrapper>
  );
}

interface BoardMenuProps {
  boardPublicId: string;
}

function BoardMenuWithPolicy({ boardPublicId }: BoardMenuProps) {
  const organizationId = useOrganizationId();
  const { allowed: canManageBoard } = usePolicy(
    hasOwnerOrAdminRole(organizationId)
  );
  if (!canManageBoard) {
    return null;
  }
  return <BoardMenu boardPublicId={boardPublicId} />;
}

function BoardMenu({ boardPublicId }: BoardMenuProps) {
  const { isMobile } = useSidebar();

  return (
    <Menu>
      <MenuTrigger
        render={(props) => (
          <SidebarMenuAction {...props} className="mr-2" showOnHover>
            <HugeiconsIcon icon={Ellipsis} />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        )}
      />

      <MenuPopup
        align={isMobile ? "end" : "start"}
        className="w-48 rounded-lg"
        side={isMobile ? "bottom" : "right"}
      >
        <RenameBoardButton boardPublicId={boardPublicId} />

        <MenuSeparator />

        <DeleteBoardButton boardPublicId={boardPublicId} />
      </MenuPopup>
    </Menu>
  );
}

const DeleteBoardButton = ({ boardPublicId }: { boardPublicId: string }) => {
  const store = useDeleteBoardDialogContext();

  return (
    <MenuItem
      onClick={() =>
        store.send({ type: "toggle", data: { boardId: boardPublicId } })
      }
    >
      <HugeiconsIcon className="text-muted-foreground" icon={Delete02Icon} />
      <span>Delete</span>
    </MenuItem>
  );
};

const RenameBoardButton = ({ boardPublicId }: { boardPublicId: string }) => {
  const store = useRenameBoardDialogContext();
  return (
    <MenuItem
      onClick={() =>
        store.send({ type: "toggle", data: { boardId: boardPublicId } })
      }
    >
      <HugeiconsIcon className="text-muted-foreground" icon={Edit} />
      <span>Rename</span>
    </MenuItem>
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
            <HugeiconsIcon icon={InternetIcon} />
            <span>Public Board</span>
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
