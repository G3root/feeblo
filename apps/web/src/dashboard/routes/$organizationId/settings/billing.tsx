import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

export const Route = createFileRoute("/$organizationId/settings/billing")({
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Billing</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Track plan details, payment methods, and billing history.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <div>
          <h2 className="font-medium text-sm">Billing</h2>
        </div>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
