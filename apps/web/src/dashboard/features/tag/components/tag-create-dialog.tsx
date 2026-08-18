import { TagId } from "@feeblo/id";
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
import { useSelector } from "@xstate/store-react";
import { z } from "zod";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useTagCreateDialogContext } from "../dialog-stores";

type TagType = "FEEDBACK" | "CHANGELOG";

export type CreatedTag = {
  id: string;
  name: string;
  type: TagType;
};

export function TagCreateDialog({
  onCreated,
}: {
  onCreated?: (tag: CreatedTag) => void | Promise<void>;
}) {
  const store = useTagCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create Tag</DialogTitle>
          <DialogDescription>
            Create a new tag for this workspace.
          </DialogDescription>
        </DialogHeader>
        <TagCreateForm onCreated={onCreated} />
      </DialogPopup>
    </Dialog>
  );
}

function TagCreateForm({
  onCreated,
}: {
  onCreated?: (tag: CreatedTag) => void | Promise<void>;
}) {
  const organizationId = useOrganizationId();
  const { tagCollection } = useDashboardCollections();
  const store = useTagCreateDialogContext();
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const type = store.get().context.data.type as TagType;

  const form = useAppForm({
    defaultValues: {
      name: "",
      type,
    },
    validators: {
      onSubmit: z.object({
        name: z.string(),
        type: z.enum(["FEEDBACK", "CHANGELOG"]),
      }),
    },
    onSubmit: async (data) => {
      try {
        const id = await TagId.unsafeGenerate();
        const tx = tagCollection.insert({
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
          name: data.value.name,
          slug: slugify(data.value.name),
          type: data.value.type,
          organizationId,
        });

        await tx.isPersisted.promise;
        await onCreated?.({
          id,
          name: data.value.name,
          type: data.value.type,
        });
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Tag created successfully",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to create tag",
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
