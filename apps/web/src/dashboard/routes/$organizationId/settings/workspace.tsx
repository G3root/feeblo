import { Input } from "@feeblo/ui/input";
import { toastManager } from "@feeblo/ui/toast";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useRef } from "react";
import { SettingsAvatarControl } from "~/features/settings/components/settings-avatar-control";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { hasOwnerOrAdminRole, usePolicy } from "@feeblo/web-shared/use-policy";
import { organizationLogoUploadEndpoint } from "@feeblo/web-shared/auth-client";
import {
  membershipCollection,
  organizationCollection,
} from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/workspace")({
  component: WorkspaceSettingsPage,
  beforeLoad: async () => {
    await Promise.all([
      membershipCollection.preload(),
      organizationCollection.preload(),
    ]);
    return null;
  },
});

function WorkspaceSettingsPage() {
  return (
    <SettingsLayout.Root>
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Workspace</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Update your workspace name and logo.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <WorkspaceDetailsSection />
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

function WorkspaceDetailsSection() {
  const organizationId = useOrganizationId();
  const { allowed: canManageOrganization, isPending: isPolicyPending } =
    usePolicy(hasOwnerOrAdminRole(organizationId));
  const organizationQuery = useLiveQuery(
    (q) =>
      q
        .from({ membership: membershipCollection })
        .join(
          { organization: organizationCollection },
          ({ membership, organization }) =>
            eq(membership.organizationId, organization.id)
        )
        .where(({ organization }) => eq(organization.id, organizationId))
        .findOne(),
    [organizationId]
  );

  const organization = organizationQuery.data?.organization ?? null;

  if (
    organizationQuery.isLoading ||
    organizationQuery.isError ||
    isPolicyPending
  ) {
    return null;
  }

  if (!organization) {
    return null;
  }

  return (
    <SettingsItem.Item>
      <SettingsItem.ItemContent>
        <SettingsItem.FieldGroup>
          <SettingsItem.Field>
            <SettingsItem.FieldContent>
              <SettingsItem.FieldLabel>Workspace logo</SettingsItem.FieldLabel>
            </SettingsItem.FieldContent>
            <WorkspaceLogoButton
              canEdit={Boolean(canManageOrganization)}
              imageUrl={organization.logo}
              name={organization.name}
              organizationId={organization.id}
            />
          </SettingsItem.Field>
        </SettingsItem.FieldGroup>
      </SettingsItem.ItemContent>
      <SettingsItem.Separator />
      <SettingsItem.ItemContent>
        <SettingsItem.FieldGroup>
          <WorkspaceNameField
            canEdit={Boolean(canManageOrganization)}
            initialName={organization.name}
            organizationId={organization.id}
          />
        </SettingsItem.FieldGroup>
      </SettingsItem.ItemContent>
    </SettingsItem.Item>
  );
}

function WorkspaceNameField({
  canEdit,
  initialName,
  organizationId,
}: {
  canEdit: boolean;
  initialName: string;
  organizationId: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleBlur() {
    if (!canEdit) {
      return;
    }

    const name = inputRef.current?.value.trim();

    if (!name) {
      toastManager.add({
        title: "Workspace name cannot be empty",
        type: "error",
      });
      return;
    }

    if (name === initialName) {
      return;
    }

    try {
      const tx = organizationCollection.update(organizationId, (draft) => {
        draft.name = name;
      });
      await tx.isPersisted.promise;
      toastManager.add({
        title: "Workspace name updated",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Failed to update workspace name",
        type: "error",
      });
    }
  }

  return (
    <SettingsItem.Field>
      <SettingsItem.FieldContent>
        <SettingsItem.FieldLabel htmlFor={id}>
          Workspace name
        </SettingsItem.FieldLabel>
      </SettingsItem.FieldContent>
      <Input
        defaultValue={initialName}
        disabled={!canEdit}
        id={id}
        onBlur={handleBlur}
        placeholder="Workspace name"
        ref={inputRef}
      />
    </SettingsItem.Field>
  );
}

function WorkspaceLogoButton({
  canEdit,
  imageUrl,
  name,
  organizationId,
}: {
  canEdit: boolean;
  imageUrl: string | null | undefined;
  name: string;
  organizationId: string;
}) {
  async function uploadWorkspaceLogo(file: File) {
    if (!canEdit) {
      return;
    }

    const formData = new FormData();
    formData.set("file", file);
    formData.set("organizationId", organizationId);

    const response = await fetch(organizationLogoUploadEndpoint, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      toastManager.add({
        title: "Failed to upload workspace logo",
        type: "error",
      });
      throw new Error("Failed to upload workspace logo");
    }

    await organizationCollection.utils.refetch();
    toastManager.add({ title: "Workspace logo updated", type: "success" });
  }

  return (
    <SettingsAvatarControl.Root
      ariaLabel="Edit workspace logo"
      imageAlt="Workspace logo"
      imageUrl={imageUrl}
      name={name}
      onRemove={async () => {
        const tx = organizationCollection.update(organizationId, (draft) => {
          draft.logo = null;
        });
        await tx.isPersisted.promise;
      }}
      onUpload={uploadWorkspaceLogo}
    >
      {imageUrl && canEdit ? (
        <SettingsAvatarControl.Dropdown>
          <SettingsAvatarControl.DropdownTrigger />
          <SettingsAvatarControl.Menu>
            <SettingsAvatarControl.ChangeItem>
              Change Logo
            </SettingsAvatarControl.ChangeItem>
            <SettingsAvatarControl.RemoveItem
              errorTitle="Failed to remove logo"
              successTitle="Logo removed successfully"
            >
              Remove Logo
            </SettingsAvatarControl.RemoveItem>
          </SettingsAvatarControl.Menu>
        </SettingsAvatarControl.Dropdown>
      ) : (
        <SettingsAvatarControl.Button disabled={!canEdit} />
      )}
    </SettingsAvatarControl.Root>
  );
}
