import { Link, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "~/components/ui/sidebar";
import { useOrganizationId } from "~/hooks/use-organization-id";

const settingsItems = [
  {
    label: "Profile",
    slug: "profile",
    to: "/$organizationId/settings/profile" as const,
  },
  {
    label: "Appearence",
    slug: "appearence",
    to: "/$organizationId/settings/appearence" as const,
  },
  {
    label: "workspace",
    slug: "workspace",
    to: "/$organizationId/settings/workspace" as const,
  },
  {
    label: "members",
    slug: "members",
    to: "/$organizationId/settings/members" as const,
  },
  {
    label: "billing",
    slug: "billing",
    to: "/$organizationId/settings/billing" as const,
  },
];

export function SettingsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const organizationId = useOrganizationId();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={(renderProps) => (
                <Link
                  {...renderProps}
                  params={{ organizationId }}
                  to="/$organizationId"
                >
                  <span>Back to App</span>
                </Link>
              )}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarMenu>
            {settingsItems.map((item) => (
              <SidebarMenuItem key={item.slug}>
                <SidebarMenuButton
                  isActive={
                    pathname === `/${organizationId}/settings/${item.slug}`
                  }
                  render={(renderProps) => (
                    <Link
                      {...renderProps}
                      params={{ organizationId }}
                      to={item.to}
                    >
                      <span>{item.label}</span>
                    </Link>
                  )}
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
