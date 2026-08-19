import { createFileRoute } from "@tanstack/react-router";

import {
  FullNameField,
  DangerZone,
  ProfileButton,
} from "~/features/settings/components/profile-sections";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

export const Route = createFileRoute("/$organizationId/settings/profile")({
  component: ProfileSettingsPage,
});

function ProfileSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Profile</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Update your account details.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <SettingsItem.Item>
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <SettingsItem.Field>
                <SettingsItem.FieldContent>
                  <SettingsItem.FieldLabel>
                    Profile picture
                  </SettingsItem.FieldLabel>
                </SettingsItem.FieldContent>
                <ProfileButton />
              </SettingsItem.Field>
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
          <SettingsItem.Separator />
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <FullNameField />
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
        </SettingsItem.Item>

        <SettingsItem.Root>
          <SettingsItem.Header>
            <SettingsItem.Title>Danger Zone</SettingsItem.Title>
          </SettingsItem.Header>
          <SettingsItem.Content>
            <DangerZone />
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
