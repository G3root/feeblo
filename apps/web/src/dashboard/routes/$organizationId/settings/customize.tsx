import { Input } from "@feeblo/ui/input";
import { Switch } from "@feeblo/ui/switch";
import { toastManager } from "@feeblo/ui/toast";
import { hasOwnerOrAdminRole, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useRef } from "react";
import { isPaidPlan } from "~/features/billing/lib/plans";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlan } from "~/hooks/use-plan";
import { useSite } from "~/hooks/use-site";
import { siteCollection, workspacePlanCollection } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

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

function SearchEngineIndexing({ canEdit }: { canEdit: boolean }) {
  const id = useId();
  const site = useSite();

  async function handleChange(value: boolean) {
    if (!(canEdit && site)) {
      return;
    }

    try {
      const tx = siteCollection.update(site.id, (draft) => {
        draft.noIndex = value;
      });
      await tx.isPersisted.promise;
      toastManager.add({
        title: "Search engine visibility updated",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Failed to update search engine visibility",
        type: "error",
      });
    }
  }

  return (
    <SettingsItem.Field>
      <SettingsItem.FieldContent>
        <SettingsItem.FieldLabel htmlFor={id}>
          Hide from search engines
        </SettingsItem.FieldLabel>
        <SettingsItem.FieldDescription>
          Ask search engines not to index any page on this public site.
        </SettingsItem.FieldDescription>
      </SettingsItem.FieldContent>
      <Switch
        checked={site?.noIndex ?? false}
        disabled={!(canEdit && site)}
        id={id}
        onCheckedChange={handleChange}
      />
    </SettingsItem.Field>
  );
}

function PublicPublicSiteNameField({ canEdit }: { canEdit: boolean }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const site = useSite();

  const initialName = site?.name;

  async function handleBlur() {
    if (!canEdit) {
      return;
    }

    const siteName = inputRef.current?.value.trim();

    if (!siteName) {
      toastManager.add({
        title: "Name cannot be empty",
        type: "error",
      });
      return;
    }

    if (siteName === initialName) {
      return;
    }

    try {
      const tx = siteCollection.update(site?.id, (draft) => {
        draft.name = siteName;
      });
      await tx.isPersisted.promise;
      toastManager.add({
        title: "Site name updated successfully",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Failed to update site name",
        type: "error",
      });
    }
  }

  return (
    <SettingsItem.Field>
      <SettingsItem.FieldContent>
        <SettingsItem.FieldLabel htmlFor={id}>Name</SettingsItem.FieldLabel>
      </SettingsItem.FieldContent>
      <Input
        defaultValue={initialName}
        disabled={!canEdit}
        id={id}
        onBlur={handleBlur}
        placeholder="Public site name"
        ref={inputRef}
      />
    </SettingsItem.Field>
  );
}

function HidePoweredByBranding({
  canEdit,
  hasPaidPlan,
}: {
  canEdit: boolean;
  hasPaidPlan: boolean;
}) {
  const id = useId();
  const site = useSite();

  async function handleChange(value: boolean) {
    if (!(canEdit && site)) {
      return;
    }

    try {
      await fetchRpc((rpc) =>
        rpc.SiteHidePoweredByBranding({
          id: site.id,
          organizationId: site.organizationId,
          hidePoweredBy: value,
        })
      );
      await siteCollection.utils.refetch();
      toastManager.add({
        title: "Branding updated successfully",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Failed to update branding",
        type: "error",
      });
    }
  }

  return (
    <SettingsItem.Field>
      <SettingsItem.FieldContent>
        <SettingsItem.FieldLabel htmlFor={id}>
          Hide "Powered by" Branding
        </SettingsItem.FieldLabel>
      </SettingsItem.FieldContent>

      <div className="flex items-center gap-2">
        {hasPaidPlan ? null : <SettingsItem.PaidPlanIndicator />}
        <Switch
          checked={site?.hidePoweredBy ?? false}
          disabled={!(canEdit && site)}
          id={id}
          onCheckedChange={handleChange}
        />
      </div>
    </SettingsItem.Field>
  );
}
