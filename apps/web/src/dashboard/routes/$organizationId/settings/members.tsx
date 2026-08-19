import { createFileRoute } from "@tanstack/react-router";

import {
  InvitationsSection,
  MembersSection,
} from "~/features/settings/components/member-sections";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { invitationsCollection, membersCollection } from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/members")({
  component: MembersSettingsPage,
  beforeLoad: async () => {
    await Promise.all([
      membersCollection.preload(),
      invitationsCollection.preload(),
    ]);
    return null;
  },
});

function MembersSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Members</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Invite teammates, adjust roles, and maintain access controls.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <MembersSection />
        <InvitationsSection />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
