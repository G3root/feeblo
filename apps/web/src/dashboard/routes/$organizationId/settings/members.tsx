import { getCachedAuthSession } from "@feeblo/web-shared/auth-session";
import { hasPermission } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";

import {
  InvitationsSection,
  MembersSection,
} from "~/features/settings/components/member-sections";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { invitationsCollection, membersCollection } from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/members")({
  component: MembersSettingsPage,
  beforeLoad: async ({ params }) => {
    const session = getCachedAuthSession();

    const promises = [membersCollection.preload()];
    const canListInvitations =
      session !== null &&
      hasPermission(params.organizationId, "members.invite")(session);

    if (canListInvitations) {
      promises.push(invitationsCollection.preload());
    }

    await Promise.all(promises);

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
