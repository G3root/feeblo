import { Input } from "@feeblo/ui/input";
import {
  SwitchCard,
  SwitchCardContent,
  SwitchCardDescription,
  SwitchCardInput,
  SwitchCardTitle,
} from "@feeblo/ui/switch-card";
import { toastManager } from "@feeblo/ui/toast";
import { useId, useRef } from "react";

import { SettingsItem } from "~/features/settings/components/settings-item";
import { useSite } from "~/hooks/use-site";
import { siteCollection } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

export function SearchEngineIndexing({ canEdit }: { canEdit: boolean }) {
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
    <SwitchCard variant="ghost">
      <SwitchCardContent>
        <SwitchCardTitle>Hide from search engines</SwitchCardTitle>
        <SwitchCardDescription>
          Ask search engines not to index any page on this public site.
        </SwitchCardDescription>
      </SwitchCardContent>
      <SwitchCardInput
        checked={site?.noIndex ?? false}
        disabled={!(canEdit && site)}
        onCheckedChange={handleChange}
      />
    </SwitchCard>
  );
}
export function PublicPublicSiteNameField({ canEdit }: { canEdit: boolean }) {
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
export function HidePoweredByBranding({
  canEdit,
  hasPaidPlan,
}: {
  canEdit: boolean;
  hasPaidPlan: boolean;
}) {
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
    <SwitchCard variant="ghost">
      <SwitchCardContent>
        <SwitchCardTitle className="inline-flex items-center gap-2">
          Hide "Powered by" Branding
          {hasPaidPlan ? null : <SettingsItem.PaidPlanIndicator />}
        </SwitchCardTitle>
        <SwitchCardDescription>
          Remove the "Powered by" branding from your public site.
        </SwitchCardDescription>
      </SwitchCardContent>
      <SwitchCardInput
        checked={site?.hidePoweredBy ?? false}
        disabled={!(canEdit && site)}
        onCheckedChange={handleChange}
      />
    </SwitchCard>
  );
}
