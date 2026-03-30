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

export const Route = createFileRoute("/$organizationId/settings/feedback-tags")(
  {
    component: RouteComponent,
  }
);

function RouteComponent() {
  return (
    <TagCreateDialogProvider defaultValue={{ data: { type: "FEEDBACK" } }}>
      <TagEditDialogProvider>
        <TagDeleteDialogProvider>
          <SettingsLayout.Root>
            <SettingsLayout.Header>
              <SettingsLayout.HeaderTitle>Feedback Tags</SettingsLayout.HeaderTitle>
              <SettingsLayout.HeaderDescription>
                Maintain the tags your team uses to categorize feedback.
              </SettingsLayout.HeaderDescription>
            </SettingsLayout.Header>
            <SettingsLayout.Content>
              <TagSettingsTable
                description="Create and manage the tags your team uses to organize incoming feedback."
                emptyDescription="Create your first feedback tag to start sorting requests and reports."
                emptyTitle="No feedback tags yet"
                title="Tag Library"
                type="FEEDBACK"
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
