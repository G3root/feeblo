import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "./-settings-section";

export const Route = createFileRoute("/$organizationId/settings/workspace")({
  component: WorkspaceSettingsPage,
});

function WorkspaceSettingsPage() {
  return (
    <SettingsSection
      description="Manage workspace-level defaults, naming, and shared preferences."
      title="workspace"
    />
  );
}
