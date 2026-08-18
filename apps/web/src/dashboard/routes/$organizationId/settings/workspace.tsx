import { createFileRoute } from "@tanstack/react-router";

import { SettingsLayout } from "~/features/settings/components/settings-layout";
import {
  membershipCollection,
  organizationCollection,
} from "~/lib/collections";

import { WorkspaceDetailsSection } from "./workspace-parts";

export const Route = createFileRoute("/$organizationId/settings/workspace")({
  component: WorkspaceSettingsPage,
  beforeLoad: async () => {
    await Promise.all([
      membershipCollection.preload(),
      organizationCollection.preload(),
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
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
