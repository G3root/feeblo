import { createFileRoute } from "@tanstack/react-router";

import { PlanLimitResolution } from "~/features/billing/components/plan-limit-resolution";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { dashboardCollections } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/plan-limits"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await dashboardCollections.workspacePlanLockCollection.preload();
    return null;
  },
});

function RouteComponent() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Plan limits</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          See what the Free plan locks in this workspace, keep the resources
          that matter, and free the rest.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <PlanLimitResolution />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
