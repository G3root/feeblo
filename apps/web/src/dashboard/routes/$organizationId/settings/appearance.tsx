import { createFileRoute } from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useTheme } from "~/components/ui/theme-provider";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

export const Route = createFileRoute("/$organizationId/settings/appearance")({
  component: AppearanceSettingsPage,
});

function AppearanceSettingsPage() {
  const { themeMode, setTheme } = useTheme();

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
                      <SettingsItem.FieldDescription>
                        Choose light, dark, or follow your system setting.
                      </SettingsItem.FieldDescription>
                    </SettingsItem.FieldContent>
                    <SettingsItem.ItemActions>
                      <Select
                        onValueChange={(value) =>
                          setTheme(value as "light" | "dark" | "auto")
                        }
                        value={themeMode}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue className="capitalize" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="auto">System</SelectItem>
                        </SelectContent>
                      </Select>
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
