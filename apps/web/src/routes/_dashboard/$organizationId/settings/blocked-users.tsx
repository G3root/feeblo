import { createFileRoute } from "@tanstack/react-router";

import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { BlockedUsersSection } from "~/features/user-block/components/blocked-users-section";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/blocked-users"
)({
  component: BlockedUsersSettingsPage,
});

function BlockedUsersSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Blocked users</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Stop specific end users from posting, commenting, voting, or
          subscribing, without deleting their history.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <BlockedUsersSection />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
