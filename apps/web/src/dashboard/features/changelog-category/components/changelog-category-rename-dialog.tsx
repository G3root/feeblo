import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useChangelogCategoryEditDialogContext } from "../dialog-stores";
import {
  CHANGELOG_CATEGORY_COLORS,
  type ChangelogCategoryFormValues,
  changelogCategoryFormOpts,
} from "../shared-form";
import { ChangelogCategoryFields } from "./changelog-category-fields";

export function ChangelogCategoryRenameDialog() {
  const store = useChangelogCategoryEditDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Edit Category</DialogTitle>
          <DialogDescription>
            Update the category name or color.
          </DialogDescription>
        </DialogHeader>

        {open ? <ChangelogCategoryRenameForm /> : null}
      </DialogPopup>
    </Dialog>
  );
}

export const ChangelogCategoryEditDialog = ChangelogCategoryRenameDialog;

function ChangelogCategoryRenameForm() {
  const organizationId = useOrganizationId();
  const { changelogCategoryCollection } = useDashboardCollections();
  const store = useChangelogCategoryEditDialogContext();
  const categoryId = useSelector(
    store,
    (state) => state.context.data.categoryId
  );

  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ category: changelogCategoryCollection })
        .where(({ category }) =>
          and(
            eq(category.id, categoryId),
            eq(category.organizationId, organizationId)
          )
        )
        .limit(1),
    [organizationId, categoryId]
  );

  const category = data[0];

  const defaultValues: ChangelogCategoryFormValues = {
    name: category.name,
    color:
      CHANGELOG_CATEGORY_COLORS.find((swatch) => swatch === category.icon) ??
      CHANGELOG_CATEGORY_COLORS[0],
  };

  const form = useAppForm({
    ...changelogCategoryFormOpts,
    defaultValues,
    onSubmit: async ({ value }) => {
      try {
        const tx = changelogCategoryCollection.update(categoryId, (draft) => {
          draft.name = value.name;
          draft.iconType = "color";
          draft.icon = value.color;
        });

        await tx.isPersisted.promise;
        toastManager.add({
          title: "Category updated successfully",
          type: "success",
        });
        store.send({ type: "toggle" });
      } catch (_error) {
        toastManager.add({
          title: "Failed to update category",
          type: "error",
        });
      }
    },
  });

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <DialogPanel className="grid gap-4">
        <ChangelogCategoryFields form={form} />
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.AppForm>
          <form.SubscribeButton label="Save" />
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
