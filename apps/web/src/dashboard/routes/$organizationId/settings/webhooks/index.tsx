import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { WebhooksSettings } from "~/features/webhook/components/webhooks-settings";
import { WebhookCreateDialogProvider } from "~/features/webhook/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute("/$organizationId/settings/webhooks/")({
  component: WebhooksSettingsRoute,
});

function WebhooksSettingsRoute() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "webhooks.manage")
  );

  if (isPending) {
    return null;
  }
  if (!allowed) {
    return <SettingsAccessDenied />;
  }

  return (
    <WebhookCreateDialogProvider>
      <SettingsLayout.Root size="large">
        <SettingsLayout.Header>
          <SettingsLayout.HeaderTitle>Webhooks</SettingsLayout.HeaderTitle>
          <SettingsLayout.HeaderDescription>
            Deliver signed feedback events to your HTTPS endpoint.
          </SettingsLayout.HeaderDescription>
        </SettingsLayout.Header>
        <SettingsLayout.Content>
          <WebhooksSettings organizationId={organizationId} />
        </SettingsLayout.Content>
      </SettingsLayout.Root>
    </WebhookCreateDialogProvider>
  );
}
