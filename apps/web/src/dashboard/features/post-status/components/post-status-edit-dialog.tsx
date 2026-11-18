import type {
  TPostStatus,
  TPostStatusType,
} from "@feeblo/domain/post-status/schema";
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
import { IconPickerField } from "@feeblo/ui/icon-picker";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { toastManager } from "@feeblo/ui/toast";
import { DEFAULT_POST_STATUS_ICONS } from "@feeblo/web-shared/icons/defaults";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useRef } from "react";
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
              icon: status.icon ?? null,
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

type EditableStatus = Pick<TPostStatus, "icon" | "id" | "label" | "type"> & {
  /** The projection normalizes the optional column to an explicit null. */
  color: Exclude<TPostStatus["color"], undefined>;
};

function PostStatusEditForm({ status }: { status: EditableStatus }) {
  const { postStatusCollection } = useDashboardCollections();
  const store = usePostStatusEditDialogContext();
  // The value the form opened with; a save that only renamed the status must
  // not repoint its icon at a concurrent change.
  const initialIcon = useRef(status.icon);

  const form = useAppForm({
    defaultValues: {
      color: status.color,
      icon: status.icon,
      label: status.label,
      type: status.type,
    },
    validators: {
      onSubmit: z.object({
        color: z.string().nullable(),
        // No length rule here: an untouched stored icon must not block an
        // unrelated edit. The picker can only emit catalogue names.
        icon: z.string().trim().nullable(),
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

        const iconChanged = data.value.icon !== initialIcon.current;

        const tx = postStatusCollection.update(status.id, (draft) => {
          draft.color = data.value.color;
          draft.label = data.value.label;
          draft.type = data.value.type;

          if (iconChanged) {
            draft.icon = data.value.icon;
          }

          if (orderIndex !== undefined) {
            draft.orderIndex = orderIndex;
          }
        });

        await tx.when("settled");
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
        void form.handleSubmit();
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
        <form.Subscribe selector={(state) => state.values.type}>
          {(type) => (
            <form.AppField name="icon">
              {(field) => (
                <Field>
                  <FieldLabel>Icon</FieldLabel>
                  <IconPickerField
                    fallbackIcon={DEFAULT_POST_STATUS_ICONS[type]}
                    label="Choose icon"
                    onChange={(icon) => field.handleChange(icon)}
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.AppField>
          )}
        </form.Subscribe>
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
