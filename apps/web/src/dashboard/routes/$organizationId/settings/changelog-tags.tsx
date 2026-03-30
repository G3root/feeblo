import { createFileRoute } from "@tanstack/react-router";
import { TagCreateDialog } from "~/features/tag/components/tag-create-dialog";
import { TagDeleteDialog } from "~/features/tag/components/tag-delete-dialog";
import { TagRenameDialog } from "~/features/tag/components/tag-rename-dialog";
import { TagSettingsTable } from "~/features/tag/components/tag-settings-table";
import {
  TagCreateDialogProvider,
  TagDeleteDialogProvider,
  TagEditDialogProvider,
} from "~/features/tag/dialog-stores";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

export const Route = createFileRoute(
  "/$organizationId/settings/changelog-tags"
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <TagCreateDialogProvider defaultValue={{ data: { type: "CHANGELOG" } }}>
      <TagEditDialogProvider>
        <TagDeleteDialogProvider>
          <SettingsLayout.Root>
            <SettingsLayout.Header>
              <SettingsLayout.HeaderTitle>Changelog Tags</SettingsLayout.HeaderTitle>
              <SettingsLayout.HeaderDescription>
                Organize release notes with reusable changelog tags.
              </SettingsLayout.HeaderDescription>
            </SettingsLayout.Header>
            <SettingsLayout.Content>
              <TagSettingsTable
                description="Create and manage the tags your team uses to classify changelog entries."
                emptyDescription="Create your first changelog tag to start organizing updates."
                emptyTitle="No changelog tags yet"
                title="Tag Library"
                type="CHANGELOG"
              />
            </SettingsLayout.Content>
          </SettingsLayout.Root>
          <TagCreateDialog />
          <TagRenameDialog />
          <TagDeleteDialog />
        </TagDeleteDialogProvider>
      </TagEditDialogProvider>
    </TagCreateDialogProvider>
  );
}
