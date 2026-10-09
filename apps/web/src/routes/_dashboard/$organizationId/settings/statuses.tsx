import { createFileRoute } from "@tanstack/react-router";

import { PostStatusCreateDialog } from "~/features/post-status/components/post-status-create-dialog";
import { PostStatusDeleteDialog } from "~/features/post-status/components/post-status-delete-dialog";
import { PostStatusEditDialog } from "~/features/post-status/components/post-status-edit-dialog";
import { PostStatusSettings } from "~/features/post-status/components/post-status-settings";
import {
  PostStatusCreateDialogProvider,
  PostStatusDeleteDialogProvider,
  PostStatusEditDialogProvider,
} from "~/features/post-status/dialog-stores";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { postStatusCollection } from "~/lib/collections";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/settings/statuses"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await postStatusCollection.preload();
    return null;
  },
});

function RouteComponent() {
  return (
    <PostStatusCreateDialogProvider
      defaultValue={{ data: { type: "PENDING" } }}
    >
      <PostStatusEditDialogProvider>
        <PostStatusDeleteDialogProvider>
          <SettingsLayout.Root>
            <SettingsLayout.Header>
              <SettingsLayout.HeaderTitle>Statuses</SettingsLayout.HeaderTitle>
              <SettingsLayout.HeaderDescription>
                The statuses posts move through. New posts land in the default
                status, which cannot be deleted.
              </SettingsLayout.HeaderDescription>
            </SettingsLayout.Header>
            <SettingsLayout.Content>
              <PostStatusSettings />
            </SettingsLayout.Content>
          </SettingsLayout.Root>
          <PostStatusCreateDialog />
          <PostStatusEditDialog />
          <PostStatusDeleteDialog />
        </PostStatusDeleteDialogProvider>
      </PostStatusEditDialogProvider>
    </PostStatusCreateDialogProvider>
  );
}
