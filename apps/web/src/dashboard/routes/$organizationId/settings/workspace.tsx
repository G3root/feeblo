import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

export const Route = createFileRoute("/$organizationId/settings/workspace")({
  component: WorkspaceSettingsPage,
});

function WorkspaceSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Workspace</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Manage workspace-level defaults, naming, and shared preferences.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <div>
          <h2 className="font-medium text-sm">Workspace</h2>
        </div>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
