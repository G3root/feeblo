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
import { slugify } from "@feeblo/utils/url";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useTagEditDialogContext } from "../dialog-stores";

export function TagRenameDialog() {
  const store = useTagEditDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Rename Tag</DialogTitle>
          <DialogDescription>Rename the tag to a new name.</DialogDescription>
        </DialogHeader>
        {open ? <TagRenameForm /> : null}
      </DialogPopup>
    </Dialog>
  );
}

export const TagEditDialog = TagRenameDialog;

function TagRenameForm() {
  const organizationId = useOrganizationId();
  const { tagCollection } = useDashboardCollections();
  const store = useTagEditDialogContext();
  const tagId = useSelector(store, (state) => state.context.data.tagId);

  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ tag: tagCollection })
        .where((tag) =>
          and(eq(tag.tag.id, tagId), eq(tag.tag.organizationId, organizationId))
        )
        .orderBy((tag) => tag.tag.createdAt, "desc")
        .limit(1),
    [organizationId, tagId]
  );

  const tag = data[0];

  const form = useAppForm({
    defaultValues: {
      name: tag.name,
      type: tag.type,
    },
    validators: {
      onSubmit: z.object({
        name: z.string(),
        type: z.enum(["FEEDBACK", "CHANGELOG"]),
      }),
    },
    onSubmit: async (data) => {
      try {
        const tx = tagCollection.update(tagId, (draft) => {
          draft.name = data.value.name;
          draft.slug = slugify(data.value.name);
          draft.type = data.value.type;
        });

        await tx.isPersisted.promise;
        toastManager.add({
          title: "Tag renamed successfully",
          type: "success",
        });
        store.send({ type: "toggle" });
      } catch (_error) {
        toastManager.add({
          title: "Failed to rename tag",
          type: "error",
        });
      }
    },
  });

  return (
    <form
      className="contents"
      data-slot="form"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <DialogPanel className="grid gap-4">
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
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
