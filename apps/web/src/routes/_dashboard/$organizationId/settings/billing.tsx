import { getAuthSession } from "@feeblo/web-shared/auth-session";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CheckoutConfirmationAlert } from "~/features/billing/components/checkout-confirmation-alert";
import { CurrentPlanCard } from "~/features/billing/components/current-plan-card";
import { WorkspaceUsageCard } from "~/features/billing/components/usage-card";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlan } from "~/hooks/use-plan";
import { dashboardCollections } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/billing"
)({
  validateSearch: (search) =>
    z
      .object({
        checkout_id: z.string().min(1).optional(),
      })
      .parse(search),
  component: BillingSettingsPage,
  beforeLoad: async ({ params }) => {
    const session = await getAuthSession();

    if (
      session !== null &&
      hasPermission(params.organizationId, "billing.update")(session)
    ) {
      await dashboardCollections.workspacePlanCollection.preload();
    }

    return null;
  },
});

function BillingSettingsPage() {
  const organizationId = useOrganizationId();

  const { allowed: canManageBilling, isPending } = usePolicy(
    hasPermission(organizationId, "billing.update")
  );

  if (isPending) {
    return null;
  }

  if (!canManageBilling) {
    return <SettingsAccessDenied />;
  }

  return <BillingSettingsContent organizationId={organizationId} />;
}

function BillingSettingsContent({
  organizationId,
}: {
  organizationId: string;
}) {
  const search = Route.useSearch();

  const workspacePlan = usePlan();
  const currentPlanType = workspacePlan.data?.plan ?? "free";

  return (
    <SettingsLayout.Root size="large">
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Billing</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Review the plan, usage, and payment details for this workspace.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        {/* Keyed so a changed checkout id or workspace remounts the machine
            instead of reusing the previous id in the retry path; removing the
            id unmounts the alert entirely. */}
        {search.checkout_id ? (
          <CheckoutConfirmationAlert
            key={`${organizationId}:${search.checkout_id}`}
            checkoutId={search.checkout_id}
            organizationId={organizationId}
            plan={workspacePlan.data?.plan}
          />
        ) : null}
        <CurrentPlanCard
          organizationId={organizationId}
          plan={currentPlanType}
        />
        <WorkspaceUsageCard />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
