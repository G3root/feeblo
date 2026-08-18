import { createFileRoute } from "@tanstack/react-router";

import { ChangelogCategoryCreateDialog } from "~/features/changelog-category/components/changelog-category-create-dialog";
import { ChangelogCategoryDeleteDialog } from "~/features/changelog-category/components/changelog-category-delete-dialog";
import { ChangelogCategoryRenameDialog } from "~/features/changelog-category/components/changelog-category-rename-dialog";
import { ChangelogCategorySettingsTable } from "~/features/changelog-category/components/changelog-category-settings-table";
import {
  ChangelogCategoryCreateDialogProvider,
  ChangelogCategoryDeleteDialogProvider,
  ChangelogCategoryEditDialogProvider,
} from "~/features/changelog-category/dialog-stores";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { changelogCategoryCollection } from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/settings/changelog-categories"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await changelogCategoryCollection.preload();
    return null;
  },
});

function RouteComponent() {
  return (
    <ChangelogCategoryCreateDialogProvider>
      <ChangelogCategoryEditDialogProvider>
        <ChangelogCategoryDeleteDialogProvider>
          <SettingsLayout.Root>
            <SettingsLayout.Header>
              <SettingsLayout.HeaderTitle>
                Changelog Categories
              </SettingsLayout.HeaderTitle>
              <SettingsLayout.HeaderDescription>
                Group release notes with reusable changelog categories.
              </SettingsLayout.HeaderDescription>
            </SettingsLayout.Header>
            <SettingsLayout.Content>
              <ChangelogCategorySettingsTable />
            </SettingsLayout.Content>
          </SettingsLayout.Root>
          <ChangelogCategoryCreateDialog />
          <ChangelogCategoryRenameDialog />
          <ChangelogCategoryDeleteDialog />
        </ChangelogCategoryDeleteDialogProvider>
      </ChangelogCategoryEditDialogProvider>
    </ChangelogCategoryCreateDialogProvider>
  );
}
