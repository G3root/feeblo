import { useAtomMount } from "@effect/atom-react";
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
import {
  anyPolicy,
  hasPermission,
  PolicyGuard,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import {
  Analytics01Icon,
  Building06Icon,
  Delete02Icon,
  Edit,
  Ellipsis,
  Home,
  InboxIcon,
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
import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { UpgradePlanDialog } from "~/features/billing/components/upgrade-dialog";
import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import {
  useCreateBoardDialogContext,
  useDeleteBoardDialogContext,
  useRenameBoardDialogContext,
} from "~/features/board/dialog-stores";
import {
  DEFAULT_INSIGHTS_RANGE,
  workspaceInsightsAtom,
} from "~/features/insights/atoms";
import { useOrgBoards } from "~/hooks/use-org-boards";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlan } from "~/hooks/use-plan";
import { usePublicSiteUrl } from "~/hooks/use-site";

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
            <InsightsNav pathname={pathname} />
            <MyFeedbackLink pathname={pathname} />
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
            <RoadmapNav pathname={pathname} />
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
  const organizationId = useOrganizationId();
  const store = useCreateBoardDialogContext();
  // Backend mirror: BoardPolicy.canCreate requires admin/owner boards.create.
  const { allowed: canCreateBoard } = usePolicy(
    hasPermission(organizationId, "boards.create")
  );

  if (!canCreateBoard) {
    return null;
  }

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
  const boardQuery = useOrgBoards(organizationId);
  // The shared org-boards query is unordered; the sidebar keeps its
  // newest-first order locally.
  const boards = useMemo(
    () =>
      (boardQuery.data ?? []).toSorted(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
      ),
    [boardQuery.data]
  );

  if (boardQuery.isLoading) {
    return (
      <SkeletonLoader isLoading>
        {Array.from({ length: 2 }, (_, index) => (
          <BoardItem
            boardPublicId={`board-id-${index}`}
            boardSlug={`board-slug-${index}`}
            key={`board-skeleton-${index}`}
            name="Loading"
          />
        ))}
      </SkeletonLoader>
    );
  }

  return (
    <SkeletonLoader isLoading={false}>
      {boards.map((board) => (
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

function BoardItem({ boardPublicId, name, boardSlug }: BoardItemProp) {
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
        <BoardMenu boardPublicId={boardPublicId} />
      </SidebarMenuItem>
    </SkeletonWrapper>
  );
}

interface BoardMenuProps {
  boardPublicId: string;
}

function BoardMenu({ boardPublicId }: BoardMenuProps) {
  const { isMobile } = useSidebar();
  const organizationId = useOrganizationId();

  const { allowed: canManageBoard } = usePolicy(
    anyPolicy(
      hasPermission(organizationId, "boards.update"),
      hasPermission(organizationId, "boards.delete")
    )
  );
  return (
    <Menu>
      <MenuTrigger
        disabled={!canManageBoard}
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
        <PolicyGuard policy={hasPermission(organizationId, "boards.update")}>
          {({ allowed }) => (
            <RenameBoardButton
              boardPublicId={boardPublicId}
              disabled={!allowed}
            />
          )}
        </PolicyGuard>

        <MenuSeparator />

        <PolicyGuard policy={hasPermission(organizationId, "boards.delete")}>
          {({ allowed }) => (
            <DeleteBoardButton
              boardPublicId={boardPublicId}
              disabled={!allowed}
            />
          )}
        </PolicyGuard>
      </MenuPopup>
    </Menu>
  );
}

const DeleteBoardButton = ({
  boardPublicId,
  disabled = false,
}: {
  boardPublicId: string;
  disabled?: boolean;
}) => {
  const store = useDeleteBoardDialogContext();

  return (
    <MenuItem
      disabled={disabled}
      onClick={() =>
        store.send({ type: "toggle", data: { boardId: boardPublicId } })
      }
    >
      <HugeiconsIcon className="text-muted-foreground" icon={Delete02Icon} />
      <span>Delete</span>
    </MenuItem>
  );
};

const RenameBoardButton = ({
  boardPublicId,
  disabled = false,
}: {
  boardPublicId: string;
  disabled?: boolean;
}) => {
  const store = useRenameBoardDialogContext();
  return (
    <MenuItem
      disabled={disabled}
      onClick={() =>
        store.send({ type: "toggle", data: { boardId: boardPublicId } })
      }
    >
      <HugeiconsIcon className="text-muted-foreground" icon={Edit} />
      <span>Rename</span>
    </MenuItem>
  );
};

/**
 * The insights entry warms the page's data on intent.
 *
 * The router already preloads the route's code on hover and focus
 * (`defaultPreload: "intent"`), but the page's numbers would still wait for the
 * click. Mounting the query atom the moment the pointer or focus reaches the
 * link starts the RPC early, and because the prefetch component stays mounted
 * after the first intent, leaving the link does not interrupt the request.
 */
function InsightsNav({ pathname }: { pathname: string }) {
  const organizationId = useOrganizationId();
  const [prefetch, setPrefetch] = useState(false);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={pathname.startsWith(`/${organizationId}/insights`)}
        render={(props) => (
          <Link
            {...props}
            onFocus={() => setPrefetch(true)}
            onMouseEnter={() => setPrefetch(true)}
            params={{ organizationId }}
            to="/$organizationId/insights"
          >
            <HugeiconsIcon icon={Analytics01Icon} />
            <span>Insights</span>
          </Link>
        )}
      />
      {prefetch ? <InsightsPrefetch organizationId={organizationId} /> : null}
    </SidebarMenuItem>
  );
}

/**
 * Mounts the insights query without reading it.
 *
 * The dashboard's link preloading only covers route code and collection
 * reads; this atom is the page's one server round trip, so it is the piece a
 * hover has to start to make the navigation feel instant. The component
 * subscribes to nothing, so it cannot re-render the sidebar when the result
 * arrives.
 */
function InsightsPrefetch({ organizationId }: { organizationId: string }) {
  useAtomMount(
    workspaceInsightsAtom({
      organizationId,
      range: DEFAULT_INSIGHTS_RANGE,
    })
  );

  return null;
}

function RoadmapNav({ pathname }: { pathname: string }) {
  const organizationId = useOrganizationId();
  const isActive = pathname.startsWith(`/${organizationId}/roadmap`);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
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
  );
}

function MyFeedbackLink({ pathname }: { pathname: string }) {
  const organizationId = useOrganizationId();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={pathname.startsWith(`/${organizationId}/my-feedback`)}
        render={(props) => (
          <Link
            {...props}
            params={{ organizationId }}
            to="/$organizationId/my-feedback"
          >
            <HugeiconsIcon icon={InboxIcon} />
            <span>My feedback</span>
          </Link>
        )}
      />
    </SidebarMenuItem>
  );
}

function MyBoardLink() {
  const publicSiteUrl = usePublicSiteUrl();

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
  const plan = usePlan().data?.plan;

  // The dialog sells the plans above the current one, so it is only an upgrade
  // path on Free. Paid workspaces manage their subscription from billing
  // settings instead, and the button would otherwise offer a plan they hold.
  if (plan !== "free") {
    return null;
  }

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
