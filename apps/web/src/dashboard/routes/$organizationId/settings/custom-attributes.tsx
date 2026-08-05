import { getAuthSession } from "@feeblo/web-shared/auth-session";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { CustomAttributeCreateDialog } from "~/features/custom-attribute/components/custom-attribute-create-dialog";
import { CustomAttributeDeleteDialog } from "~/features/custom-attribute/components/custom-attribute-delete-dialog";
import { CustomAttributeEditDialog } from "~/features/custom-attribute/components/custom-attribute-edit-dialog";
import { CustomAttributesSettings } from "~/features/custom-attribute/components/custom-attributes-settings";
import {
  CustomAttributeCreateDialogProvider,
  CustomAttributeDeleteDialogProvider,
  CustomAttributeEditDialogProvider,
} from "~/features/custom-attribute/dialog-stores";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import {
  companyAttributeDefinitionCollection,
  contactAttributeDefinitionCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/settings/custom-attributes"
)({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    const session = await getAuthSession();
    if (
      session !== null &&
      hasPermission(params.organizationId, "contacts.*")(session)
    ) {
      await Promise.all([
        contactAttributeDefinitionCollection.preload(),
        companyAttributeDefinitionCollection.preload(),
      ]);
    }
    return null;
  },
});

function RouteComponent() {
  const organizationId = useOrganizationId();
  const { allowed: canManageAttributes, isPending } = usePolicy(
    hasPermission(organizationId, "contacts.*")
  );

  if (isPending) {
    return null;
  }
  if (!canManageAttributes) {
    return <SettingsAccessDenied />;
  }

  return (
    <CustomAttributeCreateDialogProvider
      defaultValue={{ data: { entityType: "contact" } }}
    >
      <CustomAttributeEditDialogProvider
        defaultValue={{
          data: { attributeId: "", entityType: "contact" },
        }}
      >
        <CustomAttributeDeleteDialogProvider
          defaultValue={{
            data: { attributeId: "", entityType: "contact" },
          }}
        >
          <SettingsLayout.Root>
            <SettingsLayout.Header>
              <SettingsLayout.HeaderTitle>
                Custom attributes
              </SettingsLayout.HeaderTitle>
              <SettingsLayout.HeaderDescription>
                Define the extra details your team tracks for contacts and
                companies.
              </SettingsLayout.HeaderDescription>
            </SettingsLayout.Header>
            <SettingsLayout.Content>
              <CustomAttributesSettings />
            </SettingsLayout.Content>
          </SettingsLayout.Root>
          <CustomAttributeCreateDialog />
          <CustomAttributeEditDialog />
          <CustomAttributeDeleteDialog />
        </CustomAttributeDeleteDialogProvider>
      </CustomAttributeEditDialogProvider>
    </CustomAttributeCreateDialogProvider>
  );
}
