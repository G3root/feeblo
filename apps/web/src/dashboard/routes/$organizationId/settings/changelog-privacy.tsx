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

export const Route = createFileRoute(
  "/$organizationId/settings/changelog-privacy"
)({
  component: ChangelogPrivacySettingsPage,
  beforeLoad: async () => {
    await siteCollection.preload();
    return null;
  },
});

function ChangelogPrivacySettingsPage() {
  const organizationId = useOrganizationId();
  const { allowed: canManagePrivacy, isPending: isPolicyPending } = usePolicy(
    hasPermission(organizationId, "site.update")
  );
  const site = useSite();
  const [isPending, startTransition] = useTransition();

  const handleCheckedChange = (checked: boolean) => {
    if (!(site && canManagePrivacy)) {
      return;
    }

    startTransition(async () => {
      try {
        const tx = siteCollection.update(site.id, (draft) => {
          draft.changelogVisibility = checked ? "PUBLIC" : "HIDDEN";
        });

        await tx.isPersisted.promise;

        toastManager.add({
          title: "Changelog privacy updated",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to update changelog privacy",
          type: "error",
        });
      }
    });
  };

  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>
          Changelog privacy
        </SettingsLayout.HeaderTitle>
      </SettingsLayout.Header>

      <SettingsLayout.Content>
        <SettingsItem.Root>
          <SettingsItem.Content>
            <SwitchCard>
              <SwitchCardContent>
                <SwitchCardTitle>
                  Show changelog on public board
                </SwitchCardTitle>
                <SwitchCardDescription>
                  When disabled, the public changelog tab and published
                  changelog routes are hidden from visitors.
                </SwitchCardDescription>
              </SwitchCardContent>
              <SwitchCardInput
                checked={site?.changelogVisibility === "PUBLIC"}
                disabled={
                  !(site && canManagePrivacy) || isPending || isPolicyPending
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
