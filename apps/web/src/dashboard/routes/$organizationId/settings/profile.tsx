import { Button } from "@feeblo/ui/button";
import { Input } from "@feeblo/ui/input";
import { toastManager } from "@feeblo/ui/toast";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useRef } from "react";
import { SettingsAvatarControl } from "~/features/settings/components/settings-avatar-control";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { authClient, profilePictureUploadEndpoint } from "@feeblo/web-shared/auth-client";

export const Route = createFileRoute("/$organizationId/settings/profile")({
  component: ProfileSettingsPage,
});

function ProfileSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Profile</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Update your account details.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <SettingsItem.Item>
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <SettingsItem.Field>
                <SettingsItem.FieldContent>
                  <SettingsItem.FieldLabel>
                    Profile picture
                  </SettingsItem.FieldLabel>
                </SettingsItem.FieldContent>
                <ProfileButton />
              </SettingsItem.Field>
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
          <SettingsItem.Separator />
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <FullNameField />
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
        </SettingsItem.Item>

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

function FullNameField() {
  const id = useId();
  const { data, refetch } = useAuthState();
  const inputRef = useRef<HTMLInputElement>(null);

  if (!data?.user) {
    return null;
  }

  async function handleBlur() {
    const currentName = data?.user?.name;
    if (!currentName) {
      return;
    }
    const name = inputRef.current?.value.trim();
    if (!name || name === "") {
      toastManager.add({
        title: "Full name cannot be empty",
        type: "error",
      });

      return;
    }
    if (name === currentName) {
      return;
    }

    try {
      await authClient.updateUser({ name });
      toastManager.add({
        title: "Full name updated",
        type: "success",
      });
      await refetch();
    } catch (_error) {
      toastManager.add({
        title: "Failed to update full name",
        type: "error",
      });
    }
  }

  return (
    <SettingsItem.Field>
      <SettingsItem.FieldContent>
        <SettingsItem.FieldLabel htmlFor={id}>
          Full name
        </SettingsItem.FieldLabel>
      </SettingsItem.FieldContent>
      <Input
        defaultValue={data.user.name}
        id={id}
        onBlur={handleBlur}
        placeholder="Full name"
        ref={inputRef}
      />
    </SettingsItem.Field>
  );
}

function DangerZone() {
  return (
    <SettingsItem.Item>
      <SettingsItem.ItemContent>
        <SettingsItem.FieldGroup>
          <SettingsItem.Field>
            <SettingsItem.FieldContent>
              <SettingsItem.ItemTitle>Delete account</SettingsItem.ItemTitle>
              <SettingsItem.FieldDescription>
                Delete your account and all associated data. This action is
                irreversible.
              </SettingsItem.FieldDescription>
            </SettingsItem.FieldContent>
            <SettingsItem.ItemActions>
              <Button size="sm" variant="destructive">
                <HugeiconsIcon icon={Delete02Icon} /> Delete account
              </Button>
            </SettingsItem.ItemActions>
          </SettingsItem.Field>
        </SettingsItem.FieldGroup>
      </SettingsItem.ItemContent>
    </SettingsItem.Item>
  );
}

function ProfileButton() {
  const { data, refetch } = useAuthState();

  if (!data?.user) {
    return null;
  }

  async function uploadProfilePicture(file: File) {
    const formData = new FormData();
    formData.set("file", file);

    const response = await fetch(profilePictureUploadEndpoint, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      toastManager.add({
        title: "Failed to upload profile picture",
        type: "error",
      });
      throw new Error("Failed to upload profile picture");
    }

    await refetch();
    toastManager.add({ title: "Profile picture updated", type: "success" });
  }

  return (
    <SettingsAvatarControl.Root
      ariaLabel="Edit profile picture"
      imageAlt="Profile picture"
      imageUrl={data?.user?.image}
      name={data?.user?.name}
      onRemove={async () => {
        await authClient.updateUser({
          image: null,
        });
        await refetch();
      }}
      onUpload={uploadProfilePicture}
    >
      {data?.user?.image ? (
        <SettingsAvatarControl.Dropdown>
          <SettingsAvatarControl.DropdownTrigger />
          <SettingsAvatarControl.Menu>
            <SettingsAvatarControl.ChangeItem>
              Change Avatar
            </SettingsAvatarControl.ChangeItem>
            <SettingsAvatarControl.RemoveItem
              errorTitle="Failed to remove avatar"
              successTitle="Avatar removed successfully"
            >
              Remove Avatar
            </SettingsAvatarControl.RemoveItem>
          </SettingsAvatarControl.Menu>
        </SettingsAvatarControl.Dropdown>
      ) : (
        <SettingsAvatarControl.Button />
      )}
    </SettingsAvatarControl.Root>
  );
}
