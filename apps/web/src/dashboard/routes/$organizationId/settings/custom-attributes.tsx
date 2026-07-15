import { createFileRoute } from "@tanstack/react-router";
import { CustomAttributeCreateDialog } from "~/features/custom-attribute/components/custom-attribute-create-dialog";
import { CustomAttributesSettings } from "~/features/custom-attribute/components/custom-attributes-settings";
import { CustomAttributeCreateDialogProvider } from "~/features/custom-attribute/dialog-stores";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import {
  companyAttributeDefinitionCollection,
  contactAttributeDefinitionCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/settings/custom-attributes"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      contactAttributeDefinitionCollection.preload(),
      companyAttributeDefinitionCollection.preload(),
    ]);
    return null;
  },
});

function RouteComponent() {
  return (
    <CustomAttributeCreateDialogProvider
      defaultValue={{ data: { entityType: "contact" } }}
    >
      <SettingsLayout.Root>
        <SettingsLayout.Header>
          <SettingsLayout.HeaderTitle>Custom attributes</SettingsLayout.HeaderTitle>
          <SettingsLayout.HeaderDescription>
            Define the extra details your team tracks for contacts and companies.
          </SettingsLayout.HeaderDescription>
        </SettingsLayout.Header>
        <SettingsLayout.Content>
          <CustomAttributesSettings />
        </SettingsLayout.Content>
      </SettingsLayout.Root>
      <CustomAttributeCreateDialog />
    </CustomAttributeCreateDialogProvider>
  );
}
