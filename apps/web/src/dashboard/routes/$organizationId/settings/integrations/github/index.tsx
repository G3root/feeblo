import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";

import { GitHubSettings } from "~/features/github/components/github-settings";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute(
  "/$organizationId/settings/integrations/github/"
)({ component: GitHubIntegrationSettingsRoute });

function GitHubIntegrationSettingsRoute() {
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
        <SettingsLayout.HeaderTitle>GitHub</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Publish feedback to GitHub issues and synchronize linked issue status.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <GitHubSettings organizationId={organizationId} />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
