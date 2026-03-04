import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

export const Route = createFileRoute("/$organizationId/settings/appearance")({
  component: AppearanceSettingsPage,
});

function AppearanceSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Appearance</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Customize visual preferences for your workspace and board views.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <SettingsItem.Root>
          <SettingsItem.Header>
            <SettingsItem.Title>Interface and theme</SettingsItem.Title>
          </SettingsItem.Header>
          <SettingsItem.Content>
            <SettingsItem.Item>
              <SettingsItem.ItemContent>
                <SettingsItem.FieldGroup>
                  <SettingsItem.Field>
                    <SettingsItem.FieldContent>
                      <SettingsItem.FieldLabel>Theme</SettingsItem.FieldLabel>
                    </SettingsItem.FieldContent>
                    <SettingsItem.ItemActions>
                      <Button size="sm" variant="outline">
                        <HugeiconsIcon icon={ArrowRight01Icon} />
                        Change theme
                      </Button>
                    </SettingsItem.ItemActions>
                  </SettingsItem.Field>
                </SettingsItem.FieldGroup>
              </SettingsItem.ItemContent>
            </SettingsItem.Item>
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
