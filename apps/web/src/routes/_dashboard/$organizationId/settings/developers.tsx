import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";

import { ApiKeysSettings } from "~/features/api-key/components/api-keys-settings";
import {
  ApiKeyCreateDialogProvider,
  ApiKeyRevokeDialogProvider,
} from "~/features/api-key/dialog-stores";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/developers"
)({
  component: DevelopersSettingsRoute,
});

function DevelopersSettingsRoute() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "apiKeys.manage")
  );
  if (isPending) {
    return null;
  }
  if (!allowed) {
    return <SettingsAccessDenied />;
  }

  return (
    <ApiKeyCreateDialogProvider>
      <ApiKeyRevokeDialogProvider>
        <SettingsLayout.Root size="large">
          <SettingsLayout.Header>
            <SettingsLayout.HeaderTitle>Developers</SettingsLayout.HeaderTitle>
            <SettingsLayout.HeaderDescription>
              Machine credentials for reading this workspace's feedback
              programmatically.
            </SettingsLayout.HeaderDescription>
          </SettingsLayout.Header>
          <SettingsLayout.Content>
            <ApiKeysSettings organizationId={organizationId} />
          </SettingsLayout.Content>
        </SettingsLayout.Root>
      </ApiKeyRevokeDialogProvider>
    </ApiKeyCreateDialogProvider>
  );
}
