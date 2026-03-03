import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { toastManager } from "~/components/ui/toast";
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
  const formKey = `${session?.user?.id ?? "anonymous"}-${session?.user?.name ?? ""}-${session?.user?.image ?? ""}`;

  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Profile</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Update your account details.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <ProfileForm
          email={session?.user?.email ?? ""}
          image={session?.user?.image ?? ""}
          key={formKey}
          name={session?.user?.name ?? ""}
        />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

const ProfileFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  image: z.string(),
});

function ProfileForm({
  name,
  image,
  email,
}: {
  name: string;
  image: string;
  email: string;
}) {
  const form = useAppForm({
    defaultValues: {
      name,
      image,
    },
    validators: {
      onSubmit: ProfileFormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.updateUser({
        name: value.name.trim(),
        image: value.image.trim() || undefined,
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
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="settings-email">Email</Label>
        <Input disabled id="settings-email" type="email" value={email} />
      </div>

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

      <form.AppField
        children={(field) => (
          <field.TextField
            id="settings-image"
            label="Image URL"
            placeholder="https://..."
          />
        )}
        name="image"
      />

      <div className="pt-2">
        <form.AppForm>
          <form.SubscribeButton label="Save profile" type="submit" />
        </form.AppForm>
      </div>
    </form>
  );
}
