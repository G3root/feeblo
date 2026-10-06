import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";

import { SubmissionNotificationSetting } from "~/features/settings/components/notification-sections";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";

/**
 * The page the unsubscribe link in submission-notification email points at.
 * It is per workspace because the preference is: the same account can receive
 * the emails for one workspace and not another.
 */
export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/notifications"
)({
  component: NotificationsSettingsPage,
});

function NotificationsSettingsPage() {
  const organizationId = useOrganizationId();
  const { allowed: canManageNotifications, isPending } = usePolicy(
    hasPermission(organizationId, "workspace.update")
  );

  if (isPending) {
    return null;
  }

  if (!canManageNotifications) {
    return <SettingsAccessDenied />;
  }

  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Notifications</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Choose which emails this workspace sends to your account.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <SettingsItem.Root>
          <SettingsItem.Header>
            <SettingsItem.Title>Email</SettingsItem.Title>
            <SettingsItem.Description>
              Delivery preferences for this workspace. Submission emails go to
              workspace owners and administrators only.
            </SettingsItem.Description>
          </SettingsItem.Header>
          <SettingsItem.Content>
            <SubmissionNotificationSetting />
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
