import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
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
  // Same permission as the sidebar entry and the SiteUpdate mutation
  // (`site.*`) — keep all three spellings aligned.
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "site.update")
  );
  const plan = usePlan();

  const canEditSite = allowed && !isPending;
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
              <PublicPublicSiteNameField canEdit={canEditSite} />
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
          <SettingsItem.Separator />
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <SearchEngineIndexing canEdit={canEditSite} />
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
          <SettingsItem.Separator />
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <HidePoweredByBranding
                canEdit={canEditSite && isPaidPlan_}
                hasPaidPlan={isPaidPlan_}
              />
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
        </SettingsItem.Item>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
