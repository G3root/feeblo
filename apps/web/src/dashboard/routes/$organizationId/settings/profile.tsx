import {
  Cancel01Icon,
  Delete02Icon,
  Edit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { toastManager } from "~/components/ui/toast";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { authClient, profilePictureUploadEndpoint } from "~/lib/auth-client";

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
  const { data, refetch } = authClient.useSession();
  const inputRef = useRef<HTMLInputElement>(null);

  if (!data) {
    return null;
  }

  async function handleBlur() {
    const currentName = data?.user.name;
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
  const { data, refetch } = authClient.useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!data) {
    return null;
  }

  const imageUrl = data.user.image;
  const name = data.user.name;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.set("file", file);

    try {
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
        return;
      }

      await refetch();
      toastManager.add({ title: "Profile picture updated", type: "success" });
    } catch {
      toastManager.add({
        title: "Failed to upload profile picture",
        type: "error",
      });
    }

    event.target.value = "";
  }

  function triggerFileInput() {
    fileInputRef.current?.click();
  }

  return (
    <>
      <input
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      {imageUrl ? (
        <AvatarDropdown onChangeAvatar={triggerFileInput} />
      ) : (
        <AvatarButton
          imageUrl={imageUrl}
          name={name}
          onClick={triggerFileInput}
        />
      )}
    </>
  );
}

interface AvatarButtonProps extends React.ComponentProps<"button"> {
  imageUrl: string | null | undefined;
  name: string;
}

function AvatarButton({ name, imageUrl, ...props }: AvatarButtonProps) {
  return (
    <button aria-label="Edit profile picture" type="button" {...props}>
      <Avatar>
        {imageUrl ? <AvatarImage alt="Profile picture" src={imageUrl} /> : null}
        <AvatarFallback>
          {name.trim().slice(0, 1).toUpperCase() || "U"}
        </AvatarFallback>
      </Avatar>
    </button>
  );
}

function AvatarDropdown({ onChangeAvatar }: { onChangeAvatar: () => void }) {
  const { data, refetch } = authClient.useSession();
  if (!data) {
    return null;
  }

  const imageUrl = data.user.image;
  const name = data.user.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<AvatarButton imageUrl={imageUrl} name={name} />}
      />
      <DropdownMenuContent className="w-40">
        <DropdownMenuItem onClick={onChangeAvatar}>
          <HugeiconsIcon icon={Edit01Icon} />
          <span>Change Avatar</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await authClient.updateUser({
              image: null,
            });
            refetch();
            toastManager.add({
              title: "Avatar removed successfully",
              type: "success",
            });
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
          <span>Remove Avatar</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
