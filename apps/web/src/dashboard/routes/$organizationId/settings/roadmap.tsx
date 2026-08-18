import {
  SwitchCard,
  SwitchCardContent,
  SwitchCardDescription,
  SwitchCardInput,
  SwitchCardTitle,
} from "@feeblo/ui/switch-card";
import { toastManager } from "@feeblo/ui/toast";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useTransition } from "react";

import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useSite } from "~/hooks/use-site";
import { siteCollection } from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/roadmap")({
  component: RouteComponent,
  beforeLoad: async () => {
    await siteCollection.preload();
    return null;
  },
});

function RouteComponent() {
  const organizationId = useOrganizationId();
  const { allowed: canManageRoadmap, isPending: isPolicyPending } = usePolicy(
    hasPermission(organizationId, "site.update")
  );
  const site = useSite();
  const [isPending, startTransition] = useTransition();

  const handleCheckedChange = (checked: boolean) => {
    if (!(site && canManageRoadmap)) {
      return;
    }

    startTransition(async () => {
      try {
        const tx = siteCollection.update(site.id, (draft) => {
          draft.roadmapVisibility = checked ? "PUBLIC" : "HIDDEN";
        });

        await tx.isPersisted.promise;

        toastManager.add({
          title: "Roadmap visibility updated",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to update roadmap visibility",
          type: "error",
        });
      }
    });
  };
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>
          Roadmap settings
        </SettingsLayout.HeaderTitle>
      </SettingsLayout.Header>

      <SettingsLayout.Content>
        <SettingsItem.Root>
          <SettingsItem.Content>
            <SwitchCard>
              <SwitchCardContent>
                <SwitchCardTitle>Show roadmap on public board</SwitchCardTitle>
                <SwitchCardDescription>
                  When disabled, the public roadmap tab and published roadmap
                  routes are hidden from visitors.
                </SwitchCardDescription>
              </SwitchCardContent>
              <SwitchCardInput
                checked={site?.roadmapVisibility === "PUBLIC"}
                disabled={
                  !(site && canManageRoadmap) || isPending || isPolicyPending
                }
                onCheckedChange={handleCheckedChange}
              />
            </SwitchCard>
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
