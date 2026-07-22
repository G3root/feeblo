import { Avatar, AvatarFallback, AvatarImage } from "@feeblo/ui/avatar";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@feeblo/ui/sidebar";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { Plus, Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const organizationId = useOrganizationId();
  const { organizationCollection } = useDashboardCollections();
  const organizationsQuery = useLiveQuery(
    (q) =>
      q
        .from({ organization: organizationCollection })
        .orderBy(({ organization }) => organization.createdAt, "desc"),
    []
  );

  const data = organizationsQuery.data ?? [];

  const selectedOrganization =
    data.find((organization) => organization.id === organizationId) ??
    data?.[0] ??
    null;

  return (
    <SkeletonLoader isLoading={organizationsQuery.isLoading}>
      <SidebarMenu>
        <SidebarMenuItem>
          <Menu>
            <MenuTrigger
              render={(props) => (
                <SkeletonWrapper>
                  <SidebarMenuButton
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    size="lg"
                    {...props}
                  >
                    <Avatar>
                      {selectedOrganization?.logo ? (
                        <AvatarImage
                          alt={selectedOrganization.name}
                          className="rounded-lg"
                          src={selectedOrganization.logo}
                        />
                      ) : null}
                      <AvatarFallback>
                        {selectedOrganization?.name.slice(0, 1) ?? "W"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-0.5 leading-none">
                      <span className="font-medium">
                        {selectedOrganization?.name ?? "Select workspace"}
                      </span>
                      <WorkspacePlan />
                    </div>
                    <HugeiconsIcon className="ml-auto" icon={UnfoldMoreIcon} />
                  </SidebarMenuButton>
                </SkeletonWrapper>
              )}
            />
            <MenuPopup align="start">
              <WorkspaceList
                organizations={data}
                selectedOrganizationId={selectedOrganization?.id ?? null}
              />
              <MenuSeparator />

              <MenuItem
                className="justify-center"
                onClick={() =>
                  navigate({
                    to: "/register",
                  })
                }
              >
                <HugeiconsIcon className="text-muted-foreground" icon={Plus} />
                <span>Create workspace</span>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SkeletonLoader>
  );
}

function WorkspacePlan() {
  const organizationId = useOrganizationId();
  const { workspacePlanCollection } = useDashboardCollections();
  const workspacePlan = useLiveQuery(
    (q) =>
      q
        .from({ plan: workspacePlanCollection })
        .where(({ plan }) => eq(plan.organizationId, organizationId)),
    [organizationId]
  );

  const plan = workspacePlan?.data?.[0]?.plan ?? "free";

  return (
    <SkeletonLoader isLoading={workspacePlan.isLoading}>
      <SkeletonWrapper>
        <span className="text-muted-foreground text-sm">{plan}</span>
      </SkeletonWrapper>
    </SkeletonLoader>
  );
}

interface WorkspaceListProps {
  organizations: WorkspaceOrganization[];
  selectedOrganizationId: string | null;
}

interface WorkspaceOrganization {
  id: string;
  logo?: string | null;
  name: string;
}

const WorkspaceList = ({
  organizations,
  selectedOrganizationId,
}: WorkspaceListProps) => {
  return organizations.map((organization) => {
    const isSelected = organization.id === selectedOrganizationId;

    return (
      <MenuItem
        key={organization.id}
        nativeButton={false}
        render={(props) => (
          <Link
            {...props}
            params={{ organizationId: organization.id }}
            to="/$organizationId"
          >
            {organization.name}
            {isSelected ? (
              <HugeiconsIcon className="ml-auto" icon={Tick02Icon} />
            ) : null}
          </Link>
        )}
      />
    );
  });
};
