import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "~/components/ui/item";
import { toastManager } from "~/components/ui/toast";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/$organizationId/settings/profile")({
  component: ProfileSettingsPage,
});

function ProfileSettingsPage() {
  useOrganizationId();
  const { data: session } = authClient.useSession();

  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Profile</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Update your account details.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <ProfileForm name={session?.user?.name ?? ""} />
        <SettingsItem.Root>
          <SettingsItem.Header>
            <SettingsItem.Title>Danger Zone</SettingsItem.Title>
          </SettingsItem.Header>
          <SettingsItem.Content>
            <DangerZone />
          </SettingsItem.Content>
        </SettingsItem.Root>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

const ProfileFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
});

function ProfileForm({ name }: { name: string }) {
  const form = useAppForm({
    defaultValues: {
      name,
    },
    validators: {
      onSubmit: ProfileFormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.updateUser({
        name: value.name.trim(),
      });

      if (response?.error) {
        toastManager.add({
          title: response.error.message || "Failed to update profile",
          type: "error",
        });
        return;
      }

      toastManager.add({
        title: "Profile updated",
        type: "success",
      });
    },
  });

  return (
    <Card>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <form.AppField
            children={(field) => (
              <field.TextField
                id="settings-name"
                label="Name"
                placeholder="Your name"
              />
            )}
            name="name"
          />

          <div className="pt-2">
            <form.AppForm>
              <form.SubscribeButton label="Save profile" type="submit" />
            </form.AppForm>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DangerZone() {
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>Delete account</ItemTitle>
        <ItemDescription>
          Delete your account and all associated data. This action is
          irreversible.
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="destructive">
          <HugeiconsIcon icon={Delete02Icon} /> Delete account
        </Button>
      </ItemActions>
    </Item>
  );
}
