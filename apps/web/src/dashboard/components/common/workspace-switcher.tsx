import { Plus, Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveSuspenseQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { membershipCollection } from "~/lib/collections";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const organizationId = useOrganizationId();
  const { data } = useLiveSuspenseQuery((q) =>
    q
      .from({ membership: membershipCollection })
      .orderBy((membership) => membership.membership.createdAt, "desc")
  );

  const selectedMembership = useMemo(
    () =>
      data.find((membership) => membership.organizationId === organizationId) ??
      data[0] ??
      null,
    [data, organizationId]
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(props) => (
              <SidebarMenuButton
                {...props}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                size="lg"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <span className="font-semibold text-sm">
                    {selectedMembership?.organization.name.slice(0, 1) ?? "W"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-medium">Workspace</span>
                  <span className="max-w-44 truncate text-muted-foreground text-xs">
                    {selectedMembership?.organization.name ??
                      "Select workspace"}
                  </span>
                </div>
                <HugeiconsIcon className="ml-auto" icon={UnfoldMoreIcon} />
              </SidebarMenuButton>
            )}
          />
          <DropdownMenuContent align="start">
            <WorkspaceList
              memberships={data}
              selectedOrganizationId={
                selectedMembership?.organizationId ?? null
              }
            />
            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="justify-center"
              onClick={() =>
                navigate({
                  to: "/register",
                })
              }
            >
              <HugeiconsIcon className="text-muted-foreground" icon={Plus} />
              <span>Create workspace</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

interface WorkspaceListProps {
  memberships: WorkspaceMembership[];
  selectedOrganizationId: string | null;
}

interface WorkspaceMembership {
  id: string;
  organization: {
    name: string;
  };
  organizationId: string;
}

const WorkspaceList = ({
  memberships,
  selectedOrganizationId,
}: WorkspaceListProps) => {
  return memberships.map((membership) => {
    const isSelected = membership.organizationId === selectedOrganizationId;

    return (
      <DropdownMenuItem
        key={membership.id}
        render={(props) => (
          <Link
            {...props}
            params={{ organizationId: membership.organizationId }}
            to="/$organizationId"
          >
            {membership.organization.name}
            {isSelected ? (
              <HugeiconsIcon className="ml-auto" icon={Tick02Icon} />
            ) : null}
          </Link>
        )}
      />
    );
  });
};
