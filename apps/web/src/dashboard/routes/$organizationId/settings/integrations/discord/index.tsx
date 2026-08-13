import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { DiscordSettings } from "~/features/discord/components/discord-settings";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute(
  "/$organizationId/settings/integrations/discord/"
)({
  component: DiscordIntegrationSettingsRoute,
});

function DiscordIntegrationSettingsRoute() {
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
        <SettingsLayout.HeaderTitle>Discord</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Collect feedback from Discord and post new requests to your channels.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <DiscordSettings organizationId={organizationId} />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
