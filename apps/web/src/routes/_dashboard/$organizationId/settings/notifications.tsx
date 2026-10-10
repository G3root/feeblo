import { createFileRoute } from "@tanstack/react-router";

import { NotificationPreferenceSettings } from "~/features/settings/components/notification-preference-settings";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

/**
 * The member's own email notification preferences for this workspace.
 *
 * It is per workspace because the preference is: the same account can receive
 * the emails for one workspace and not another. The route is also the body
 * link in notification email, so it must stay reachable to every member.
 */
export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/notifications"
)({
  component: NotificationsSettingsPage,
});

function NotificationsSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Notifications</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Choose which emails this workspace sends to your account.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <NotificationPreferenceSettings />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
