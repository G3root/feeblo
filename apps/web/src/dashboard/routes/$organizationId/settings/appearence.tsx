import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "./-settings-section";

export const Route = createFileRoute("/$organizationId/settings/appearence")({
  component: AppearenceSettingsPage,
});

function AppearenceSettingsPage() {
  return (
    <SettingsSection
      description="Customize visual preferences for your workspace and board views."
      title="Appearence"
    />
  );
}
