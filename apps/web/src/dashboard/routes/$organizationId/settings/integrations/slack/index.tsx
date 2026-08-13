import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { SlackSettings } from "~/features/slack/components/slack-settings";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute(
  "/$organizationId/settings/integrations/slack/"
)({
  component: SlackIntegrationSettingsRoute,
});

function SlackIntegrationSettingsRoute() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "integrations.manage")
  );

  if (isPending) {
    return null;
  }
  if (!allowed) {
    return <SettingsAccessDenied />;
  }

  return (
    <SettingsLayout.Root size="large">
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Slack</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Collect feedback from Slack and post new requests to your channels.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <SlackSettings organizationId={organizationId} />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
