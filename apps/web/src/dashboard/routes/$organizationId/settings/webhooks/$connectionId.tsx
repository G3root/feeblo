import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { WebhookDetail } from "~/features/webhook/components/webhook-detail";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute(
  "/$organizationId/settings/webhooks/$connectionId"
)({
  component: WebhookDetailRoute,
});

function WebhookDetailRoute() {
  const organizationId = useOrganizationId();
  const { connectionId } = Route.useParams();
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
    <SettingsLayout.Root size="large">
      <WebhookDetail
        connectionId={connectionId}
        organizationId={organizationId}
      />
    </SettingsLayout.Root>
  );
}
