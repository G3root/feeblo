import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
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
    group: "Settings",
    subItems: [
      {
        label: "Profile",
        slug: "profile",
        to: "/$organizationId/settings/profile" as const,
      },
      {
        label: "Appearance",
        slug: "appearance",
        to: "/$organizationId/settings/appearance" as const,
      },
      {
        label: "Workspace",
        slug: "workspace",
        to: "/$organizationId/settings/workspace" as const,
      },
      {
        label: "Members",
        slug: "members",
        to: "/$organizationId/settings/members" as const,
      },
      {
        label: "Billing",
        slug: "billing",
        to: "/$organizationId/settings/billing" as const,
      },
    ],
  },
  {
    group: "Feedback",
    subItems: [
      {
        label: "Tags",
        slug: "tags",
        to: "/$organizationId/settings/feedback-tags" as const,
      },
    ],
  },
  {
    group: "Changelog",
    subItems: [
      {
        label: "Tags",
        slug: "tags",
        to: "/$organizationId/settings/changelog-tags" as const,
      },
    ],
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
                  <HugeiconsIcon icon={ArrowLeft01Icon} />
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
          {settingsItems.map((group) => (
            <Fragment key={group.group}>
              <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
              <SidebarMenu>
                {group.subItems.map((item) => (
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
            </Fragment>
          ))}
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
