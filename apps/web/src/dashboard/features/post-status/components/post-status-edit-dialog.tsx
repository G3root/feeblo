import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { toastManager } from "@feeblo/ui/toast";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { usePostStatusEditDialogContext } from "../dialog-stores";
import { postStatusSections } from "../sections";
import { PostStatusColorField } from "./post-status-color-field";

export function PostStatusEditDialog() {
  const store = usePostStatusEditDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const statusId = useSelector(store, (state) => state.context.data.statusId);
  const { postStatusCollection } = useDashboardCollections();

  const statusQuery = useLiveQuery({
    query: (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) => eq(postStatus.id, statusId)),
  });

  const status = statusQuery?.data?.[0];

  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Edit status</DialogTitle>
          <DialogDescription>
            Rename the status, change its colour, or move it to another section.
          </DialogDescription>
        </DialogHeader>
        {status ? (
          <PostStatusEditForm
            key={status.id}
            status={{
              color: status.color ?? null,
              id: status.id,
              label: status.label,
              type: status.type,
            }}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

type EditableStatus = {
  color: string | null;
  id: string;
  label: string;
  type: TPostStatusType;
};

function PostStatusEditForm({ status }: { status: EditableStatus }) {
  const { postStatusCollection } = useDashboardCollections();
  const store = usePostStatusEditDialogContext();

  const form = useAppForm({
    defaultValues: {
      color: status.color,
      label: status.label,
      type: status.type,
    },
    validators: {
      onSubmit: z.object({
        color: z.string().nullable(),
        label: z.string().min(1).max(60),
        type: z.enum([
          "PENDING",
          "REVIEW",
          "PLANNED",
          "IN_PROGRESS",
          "COMPLETED",
          "CLOSED",
        ]),
      }),
    },
    onSubmit: async (data) => {
      try {
        // A status that changes section is appended to the end of its new one,
        // mirroring what the server does with its position.
        const movesSection = data.value.type !== status.type;
        const orderIndex = movesSection
          ? Math.max(
              -1,
              ...[...postStatusCollection.values()].map((row) => row.orderIndex)
            ) + 1
          : undefined;

        const tx = postStatusCollection.update(status.id, (draft) => {
          draft.color = data.value.color;
          draft.label = data.value.label;
          draft.type = data.value.type;

          if (orderIndex !== undefined) {
            draft.orderIndex = orderIndex;
          }
        });

        await tx.isPersisted.promise;
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Status updated",
          type: "success",
        });
      } catch {
        toastManager.add({
          title: "Failed to update status",
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
          {(field) => <field.TextField label="Name" />}
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
        <form.AppField name="type">
          {(field) => (
            <Field>
              <FieldLabel>Section</FieldLabel>
              <Select
                onValueChange={(value) =>
                  // SAFETY: the options are postStatusSections, so the control
                  // can only produce one of the six type literals.
                  field.handleChange(value as TPostStatusType)
                }
                value={field.state.value}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      postStatusSections.find(
                        (section) => section.type === value
                      )?.label ?? "Select a section"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {postStatusSections.map((section) => (
                    <SelectItem key={section.type} value={section.type}>
                      {section.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
          )}
        </form.AppField>
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
