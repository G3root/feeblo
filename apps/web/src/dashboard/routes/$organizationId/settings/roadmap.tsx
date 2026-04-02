import { createFileRoute } from "@tanstack/react-router";
import { useTransition } from "react";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useSite } from "~/hooks/use-site";
import { siteCollection } from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/roadmap")({
  component: RouteComponent,
});

function RouteComponent() {
  const site = useSite();
  const [isPending, startTransition] = useTransition();

  const handleCheckedChange = (checked: boolean) => {
    if (!site) {
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
      } catch (_error) {
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
            <SettingsItem.Item>
              <SettingsItem.ItemContent>
                <SettingsItem.FieldGroup>
                  <SettingsItem.Field>
                    <SettingsItem.FieldContent>
                      <SettingsItem.FieldLabel>
                        Show roadmap on public board
                      </SettingsItem.FieldLabel>
                      <SettingsItem.FieldDescription>
                        When disabled, the public roadmap tab and published
                        roadmap routes are hidden from visitors.
                      </SettingsItem.FieldDescription>
                    </SettingsItem.FieldContent>
                    <SettingsItem.ItemActions>
                      <Switch
                        checked={site?.roadmapVisibility === "PUBLIC"}
                        disabled={!site || isPending}
                        onCheckedChange={handleCheckedChange}
                      />
                    </SettingsItem.ItemActions>
                  </SettingsItem.Field>
                </SettingsItem.FieldGroup>
              </SettingsItem.ItemContent>
            </SettingsItem.Item>
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}
