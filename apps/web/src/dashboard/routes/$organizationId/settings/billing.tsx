import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "./-settings-section";

export const Route = createFileRoute("/$organizationId/settings/billing")({
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  return (
    <SettingsSection
      description="Track plan details, payment methods, and billing history."
      title="billing"
    />
  );
}
