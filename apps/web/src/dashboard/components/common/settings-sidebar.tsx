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
} from "@feeblo/ui/sidebar";
import {
  ArrowLeft01Icon,
  Building03Icon,
  CreditCardIcon,
  LayoutThreeColumnIcon,
  PaintBrush04Icon,
  Settings05Icon,
  Shield01Icon,
  Tag01Icon,
  UserIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import { useOrganizationId } from "~/hooks/use-organization-id";

const settingsItems = [
  {
    group: "Personal",
    subItems: [
      {
        label: "Profile",
        icon: UserIcon,
        to: "/$organizationId/settings/profile" as const,
      },
      {
        label: "Preferences",
        icon: Settings05Icon,
        to: "/$organizationId/settings/preferences" as const,
      },
    ],
  },
  {
    group: "Administration",
    subItems: [
      {
        label: "Workspace",
        icon: Building03Icon,
        to: "/$organizationId/settings/workspace" as const,
      },
      {
        label: "Customize Public Site",
        icon: PaintBrush04Icon,
        to: "/$organizationId/settings/customize" as const,
      },
      {
        label: "Members",
        icon: UserMultipleIcon,
        to: "/$organizationId/settings/members" as const,
      },
      {
        label: "Billing",
        icon: CreditCardIcon,
        to: "/$organizationId/settings/billing" as const,
      },
    ],
  },
  {
    group: "Feedback & Roadmap",
    subItems: [
      {
        label: "Roadmap",
        icon: LayoutThreeColumnIcon,
        to: "/$organizationId/settings/roadmap" as const,
      },
      {
        label: "Tags",
        icon: Tag01Icon,
        to: "/$organizationId/settings/feedback-tags" as const,
      },
    ],
  },
  {
    group: "Changelog",
    subItems: [
      {
        label: "Privacy",
        icon: Shield01Icon,
        to: "/$organizationId/settings/changelog-privacy" as const,
      },
      {
        label: "Tags",
        icon: Tag01Icon,
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
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={
                        pathname ===
                        `/${organizationId}/settings/${item.to.split("/").slice(3)}`
                      }
                      render={(renderProps) => (
                        <Link
                          {...renderProps}
                          params={{ organizationId }}
                          to={item.to}
                        >
                          <HugeiconsIcon icon={item.icon} />
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
