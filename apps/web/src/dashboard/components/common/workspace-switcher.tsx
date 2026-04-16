import { Plus, Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveSuspenseQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { organizationCollection } from "~/lib/collections";
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
  const organizationsQuery = useLiveSuspenseQuery(
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
                    {selectedOrganization?.name.slice(0, 1) ?? "W"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-medium">Workspace</span>
                  <span className="max-w-44 truncate text-muted-foreground text-xs">
                    {selectedOrganization?.name ?? "Select workspace"}
                  </span>
                </div>
                <HugeiconsIcon className="ml-auto" icon={UnfoldMoreIcon} />
              </SidebarMenuButton>
            )}
          />
          <DropdownMenuContent align="start">
            <WorkspaceList
              organizations={data}
              selectedOrganizationId={selectedOrganization?.id ?? null}
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
      <DropdownMenuItem
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
