import { ChangelogCategoryId } from "@feeblo/id";
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
import { useSelector } from "@xstate/store-react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useChangelogCategoryCreateDialogContext } from "../dialog-stores";
import { changelogCategoryFormOpts } from "../shared-form";
import { ChangelogCategoryFields } from "./changelog-category-fields";

export function ChangelogCategoryCreateDialog() {
  const store = useChangelogCategoryCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create Category</DialogTitle>
          <DialogDescription>
            Create a new changelog category for this workspace.
          </DialogDescription>
        </DialogHeader>

        <ChangelogCategoryCreateForm />
      </DialogPopup>
    </Dialog>
  );
}

function ChangelogCategoryCreateForm() {
  const organizationId = useOrganizationId();
  const { changelogCategoryCollection } = useDashboardCollections();
  const store = useChangelogCategoryCreateDialogContext();

  const form = useAppForm({
    ...changelogCategoryFormOpts,
    onSubmit: async ({ value }) => {
      try {
        const id = await ChangelogCategoryId.unsafeGenerate();
        const tx = changelogCategoryCollection.insert({
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
          name: value.name,
          iconType: "color",
          icon: value.color,
          organizationId,
        });

        await tx.isPersisted.promise;
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Category created successfully",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to create category",
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
