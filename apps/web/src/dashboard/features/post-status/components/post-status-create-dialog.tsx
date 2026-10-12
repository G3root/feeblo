import { DEFAULT_POST_STATUS_COLORS } from "@feeblo/domain-contracts/post-status-colors";
import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import { PostStatusId } from "@feeblo/id";
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
import { Field, FieldLabel } from "@feeblo/ui/field";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { usePostStatusCreateDialogContext } from "../dialog-stores";
import { postStatusSections } from "../sections";
import { PostStatusColorField } from "./post-status-color-field";

export function PostStatusCreateDialog() {
  const store = usePostStatusCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const type = useSelector(store, (state) => state.context.data.type);

  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>New status</DialogTitle>
          <DialogDescription>
            Add a status to{" "}
            {postStatusSections.find((section) => section.type === type)
              ?.label ?? "this section"}
            . Posts can be filed under it as soon as it exists.
          </DialogDescription>
        </DialogHeader>
        {type === undefined ? null : (
          <PostStatusCreateForm key={type} type={type} />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function PostStatusCreateForm({ type }: { type: TPostStatusType }) {
  const organizationId = useOrganizationId();
  const { postStatusCollection } = useDashboardCollections();
  const store = usePostStatusCreateDialogContext();

  const form = useAppForm({
    defaultValues: {
      color: DEFAULT_POST_STATUS_COLORS[type],
      label: "",
    },
    validators: {
      onSubmit: z.object({
        color: z.string(),
        label: z.string().min(1).max(60),
      }),
    },
    onSubmit: async (data) => {
      try {
        const id = await PostStatusId.unsafeGenerate();
        // Appended to the end of the workspace's list, which is the end of its
        // section: every section's rows are a subset of one ascending sequence.
        const orderIndex =
          Math.max(
            -1,
            ...[...postStatusCollection.values()].map(
              (status) => status.orderIndex
            )
          ) + 1;

        const tx = postStatusCollection.insert({
          id,
          color: data.value.color,
          createdAt: new Date(),
          isDefault: false,
          label: data.value.label,
          orderIndex,
          organizationId,
          type,
          updatedAt: new Date(),
        });

        await tx.isPersisted.promise;
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Status created",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to create status",
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
        <form.AppField name="label">
          {(field) => <field.TextField label="Name" placeholder="In Review" />}
        </form.AppField>
        <form.AppField name="color">
          {(field) => (
            <Field>
              <FieldLabel>Colour</FieldLabel>
              <PostStatusColorField
                onChange={(color) => field.handleChange(color)}
                value={field.state.value}
              />
            </Field>
          )}
        </form.AppField>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.AppForm>
          <form.SubscribeButton label="Create" />
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
