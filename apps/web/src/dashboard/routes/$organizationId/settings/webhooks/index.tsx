import { getAuthSession } from "@feeblo/web-shared/auth-session";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { PaidFeatureGate } from "~/features/billing/components/paid-feature-gate";
import { isPaidPlan } from "~/features/billing/lib/plans";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { WebhooksSettings } from "~/features/webhook/components/webhooks-settings";
import { WebhookCreateDialogProvider } from "~/features/webhook/dialog-stores";
import { loadEndpoints } from "~/features/webhook/lib/endpoints";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlan } from "~/hooks/use-plan";
import { workspacePlanCollection } from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/webhooks/")({
  component: WebhooksSettingsRoute,
  beforeLoad: async ({ params }) => {
    const session = await getAuthSession();
    if (
      session !== null &&
      hasPermission(params.organizationId, "webhooks.manage")(session)
    ) {
      await Promise.all([
        loadEndpoints(params.organizationId),
        workspacePlanCollection.preload(),
      ]);
    }
    return null;
  },
});

function WebhooksSettingsRoute() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "webhooks.manage")
  );
  const plan = usePlan();

  if (isPending || plan.isLoading) {
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
          {isPaidPlan(plan.data?.plan) ? (
            <WebhooksSettings organizationId={organizationId} />
          ) : (
            <PaidFeatureGate feature="Webhooks" />
          )}
        </SettingsLayout.Content>
      </SettingsLayout.Root>
    </WebhookCreateDialogProvider>
  );
}
