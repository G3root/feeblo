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
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { hasPermission } from "@feeblo/web-shared/use-policy";
import {
  ApiIcon,
  ArrowLeft01Icon,
  Building03Icon,
  Chat01Icon,
  CreditCardIcon,
  CursorInWindowIcon,
  DashedLineCircleIcon,
  Database01Icon,
  Folder01Icon,
  LayoutThreeColumnIcon,
  LockIcon,
  Mail01Icon,
  PaintBrush04Icon,
  PropertyNewIcon,
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
      {
        label: "Notifications",
        icon: Mail01Icon,
        to: "/$organizationId/settings/notifications" as const,
      },
    ],
  },
  {
    group: "Administration",
    subItems: [
      {
        label: "Workspace",
        icon: Building03Icon,
        permission: "workspace.update" as const,
        to: "/$organizationId/settings/workspace" as const,
      },
      {
        label: "Customize Public Site",
        icon: PaintBrush04Icon,
        permission: "site.update" as const,
        to: "/$organizationId/settings/customize" as const,
      },
      {
        label: "Widget",
        icon: CursorInWindowIcon,
        permission: "site.update" as const,
        to: "/$organizationId/settings/widget" as const,
      },
      {
        label: "Members",
        icon: UserMultipleIcon,
        to: "/$organizationId/settings/members" as const,
      },
      {
        label: "Billing",
        icon: CreditCardIcon,
        permission: "billing.update" as const,
        to: "/$organizationId/settings/billing" as const,
      },
      {
        label: "Plan limits",
        icon: LockIcon,
        permission: "workspace.update" as const,
        to: "/$organizationId/settings/plan-limits" as const,
      },
      {
        label: "Security",
        icon: LockIcon,
        permission: "workspace.update" as const,
        to: "/$organizationId/settings/security" as const,
      },
      {
        label: "Webhooks",
        icon: Settings05Icon,
        permission: "webhooks.manage" as const,
        to: "/$organizationId/settings/webhooks" as const,
      },
      {
        label: "Developers",
        icon: ApiIcon,
        permission: "apiKeys.manage" as const,
        to: "/$organizationId/settings/developers" as const,
      },
      {
        label: "Integrations",
        icon: Chat01Icon,
        permission: "integrations.manage" as const,
        to: "/$organizationId/settings/integrations" as const,
      },
    ],
  },
  {
    group: "Data",
    subItems: [
      {
        label: "Imports & exports",
        icon: Database01Icon,
        // Either grant opens the page: it shows the import card and the
        // export card independently, so a role with only one still belongs here.
        permissions: ["boards.exportData", "boards.importPosts"] as const,
        to: "/$organizationId/settings/data" as const,
      },
      {
        label: "Custom attributes",
        icon: PropertyNewIcon,
        permission: "contacts.*" as const,
        to: "/$organizationId/settings/custom-attributes" as const,
      },
    ],
  },
  {
    group: "Feedback & Roadmap",
    subItems: [
      {
        label: "Statuses",
        icon: DashedLineCircleIcon,
        permission: "statuses.*" as const,
        to: "/$organizationId/settings/statuses" as const,
      },
      {
        label: "Roadmap",
        icon: LayoutThreeColumnIcon,
        permission: "site.update" as const,
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
        permission: "site.update" as const,
        to: "/$organizationId/settings/changelog-privacy" as const,
      },
      {
        label: "Categories",
        icon: Folder01Icon,
        permission: "changelog-categories.*" as const,
        to: "/$organizationId/settings/changelog-categories" as const,
      },
    ],
  },
];

export function SettingsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const organizationId = useOrganizationId();
  const { data: session } = useAuthState();
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
                {group.subItems.map((item) => {
                  const permission =
                    "permission" in item ? item.permission : undefined;
                  const permissions =
                    "permissions" in item ? item.permissions : undefined;
                  const canAccess =
                    permission === undefined && permissions === undefined
                      ? true
                      : session != null &&
                        (permission === undefined
                          ? (permissions ?? []).some((candidate) =>
                              hasPermission(organizationId, candidate)(session)
                            )
                          : hasPermission(organizationId, permission)(session));
                  const itemPath = `/${organizationId}/settings/${item.to
                    .split("/")
                    .slice(3)
                    .join("/")}`;

                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={
                          pathname === itemPath ||
                          pathname.startsWith(`${itemPath}/`)
                        }
                        render={(renderProps) =>
                          canAccess ? (
                            <Link
                              {...renderProps}
                              params={{ organizationId }}
                              to={item.to}
                            >
                              <HugeiconsIcon icon={item.icon} />
                              <span>{item.label}</span>
                            </Link>
                          ) : (
                            <span
                              {...renderProps}
                              aria-disabled="true"
                              title="You don't have permission to access this setting."
                            >
                              <HugeiconsIcon icon={item.icon} />
                              <span>{item.label}</span>
                            </span>
                          )
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </Fragment>
          ))}
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
