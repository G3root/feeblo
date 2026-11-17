import {
  SwitchCard,
  SwitchCardContent,
  SwitchCardDescription,
  SwitchCardInput,
  SwitchCardTitle,
} from "@feeblo/ui/switch-card";
import { toastManager } from "@feeblo/ui/toast";
import { useFeatureFlag } from "@feeblo/web-shared/use-feature-flag";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useTransition } from "react";

import { HelpCenterUnavailable } from "~/features/help-center/components/help-center-unavailable";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useSite } from "~/hooks/use-site";
import { dashboardCollections } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/help-center-privacy"
)({
  component: HelpCenterPrivacySettingsPage,
  beforeLoad: async () => {
    await dashboardCollections.siteCollection.preload();

    return null;
  },
});

/**
 * The help center's portal switch.
 *
 * Hiding it does not unpublish anything: every article keeps its state, and the
 * portal's policy read is what makes the section unreachable. Flipping it back
 * restores the help center exactly as it was, which is why this is a visibility
 * switch rather than a bulk unpublish.
 */
function HelpCenterPrivacySettingsPage() {
  const organizationId = useOrganizationId();

  const { allowed: canManagePrivacy, isPending: isPolicyPending } = usePolicy(
    hasPermission(organizationId, "site.update")
  );

  const site = useSite();
  const enabled = useFeatureFlag("HELP_CENTER");
  const [isPending, startTransition] = useTransition();

  const handleCheckedChange = (checked: boolean) => {
    if (!(site && canManagePrivacy)) {
      return;
    }

    startTransition(async () => {
      try {
        const tx = dashboardCollections.siteCollection.update(
          site.id,
          (draft) => {
            draft.helpCenterVisibility = checked ? "PUBLIC" : "HIDDEN";
          }
        );

        await tx.when("settled");

        toastManager.add({
          title: "Help center privacy updated",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to update help center privacy",
          type: "error",
        });
      }
    });
  };

  if (!enabled) {
    return <HelpCenterUnavailable />;
  }

  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>
          Help center privacy
        </SettingsLayout.HeaderTitle>
      </SettingsLayout.Header>

      <SettingsLayout.Content>
        <SettingsItem.Root>
          <SettingsItem.Content>
            <SwitchCard>
              <SwitchCardContent>
                <SwitchCardTitle>
                  Show help center on public board
                </SwitchCardTitle>
                <SwitchCardDescription>
                  When disabled, the help center tab and its article routes are
                  hidden from visitors. Published articles keep their state and
                  reappear when you switch this back on.
                </SwitchCardDescription>
              </SwitchCardContent>
              <SwitchCardInput
                checked={site?.helpCenterVisibility === "PUBLIC"}
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
