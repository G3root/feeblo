import { SettingsLayout } from "./settings-layout";

export function SettingsAccessDenied() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Access denied</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          You do not have permission to manage this workspace setting.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
    </SettingsLayout.Root>
  );
}
