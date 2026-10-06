import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { eq, useLiveQuery } from "@tanstack/react-db";

import { DeleteWorkspaceDialog } from "~/features/settings/components/delete-workspace-dialog";
import { SettingsItem } from "~/features/settings/components/settings-item";
import { useOrganizationId } from "~/hooks/use-organization-id";
import {
  membershipCollection,
  organizationCollection,
} from "~/lib/collections";

/**
 * The workspace half of data erasure: an owner can delete a workspace (and
 * everything the database cascades from it) without deleting their account.
 *
 * It is also one of the two ways to unblock an account deletion when the
 * workspace still has teammates — the other is removing them — because account
 * deletion refuses to take a workspace away from the people who remain.
 */
export function DeleteWorkspaceSection() {
  const organizationId = useOrganizationId();
  const { allowed: canDelete, isPending } = usePolicy(
    hasPermission(organizationId, "workspace.delete")
  );
  // The section reuses the collections `beforeLoad` already preloaded, so the
  // confirmation has the workspace name without another request.
  const organizationQuery = useLiveQuery({
    query: (q) =>
      q
        .from({ membership: membershipCollection })
        .join(
          { organization: organizationCollection },
          ({ membership, organization }) =>
            eq(membership.organizationId, organization.id)
        )
        .where(({ organization }) => eq(organization.id, organizationId))
        .findOne(),
  });
  const organization = organizationQuery.data?.organization ?? null;

  if (isPending || !canDelete || organization === null) {
    return null;
  }

  return (
    <SettingsItem.Root>
      <SettingsItem.Header>
        <SettingsItem.Title>Danger zone</SettingsItem.Title>
        <SettingsItem.Description>
          Deleting a workspace removes its boards, feedback, integrations, and
          API keys for everyone.
        </SettingsItem.Description>
      </SettingsItem.Header>
      <SettingsItem.Content>
        <SettingsItem.Item>
          <SettingsItem.ItemContent>
            <SettingsItem.FieldGroup>
              <SettingsItem.Field>
                <SettingsItem.FieldContent>
                  <SettingsItem.ItemTitle>
                    Delete workspace
                  </SettingsItem.ItemTitle>
                  <SettingsItem.FieldDescription>
                    Permanently delete {organization.name} and all of its data.
                    This action is irreversible.
                  </SettingsItem.FieldDescription>
                </SettingsItem.FieldContent>
                <SettingsItem.ItemActions>
                  <DeleteWorkspaceDialog
                    organizationId={organizationId}
                    workspaceName={organization.name}
                  />
                </SettingsItem.ItemActions>
              </SettingsItem.Field>
            </SettingsItem.FieldGroup>
          </SettingsItem.ItemContent>
        </SettingsItem.Item>
      </SettingsItem.Content>
    </SettingsItem.Root>
  );
}
