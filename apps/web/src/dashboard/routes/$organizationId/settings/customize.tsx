import { hasOwnerOrAdminRole, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";

import { isPaidPlan } from "~/features/billing/lib/plans";
import {
  SearchEngineIndexing,
  PublicPublicSiteNameField,
  HidePoweredByBranding,
} from "~/features/settings/components/customize-sections";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlan } from "~/hooks/use-plan";
import { siteCollection, workspacePlanCollection } from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/customize")({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      siteCollection.preload(),
      workspacePlanCollection.preload(),
    ]);
    return null;
  },
});

function RouteComponent() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(hasOwnerOrAdminRole(organizationId));
  const plan = usePlan();

  const isAdmin = allowed && !isPending;
  const isPaidPlan_ = isPaidPlan(plan.data?.plan);
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Customize</SettingsLayout.HeaderTitle>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <SettingsItem.Item>
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <PublicPublicSiteNameField canEdit={isAdmin} />
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
          <SettingsItem.Separator />
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <SearchEngineIndexing canEdit={isAdmin} />
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
          <SettingsItem.Separator />
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <HidePoweredByBranding
                canEdit={isAdmin && isPaidPlan_}
                hasPaidPlan={isPaidPlan_}
              />
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
        </SettingsItem.Item>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
