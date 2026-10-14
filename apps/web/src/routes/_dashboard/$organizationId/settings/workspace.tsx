import { createFileRoute } from "@tanstack/react-router";

import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { DeleteWorkspaceSection } from "~/features/settings/components/workspace-danger-zone";
import { WorkspaceDetailsSection } from "~/features/settings/components/workspace-details-section";
import { dashboardCollections } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/workspace"
)({
  component: WorkspaceSettingsPage,
  beforeLoad: async () => {
    await Promise.all([
      dashboardCollections.membershipCollection.preload(),
      dashboardCollections.organizationCollection.preload(),
    ]);
    return null;
  },
});

function WorkspaceSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Workspace</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Update your workspace name and logo.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <WorkspaceDetailsSection />
        <DeleteWorkspaceSection />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
