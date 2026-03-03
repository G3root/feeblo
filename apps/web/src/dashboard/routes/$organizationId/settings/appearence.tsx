import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

export const Route = createFileRoute("/$organizationId/settings/appearence")({
  component: AppearenceSettingsPage,
});

function AppearenceSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Appearence</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Customize visual preferences for your workspace and board views.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <div>
          <h2 className="font-medium text-sm">Theme</h2>
        </div>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
