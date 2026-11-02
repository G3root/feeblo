import {
  SAVED_VIEW_DESCRIPTION_MAX_LENGTH,
  SAVED_VIEW_NAME_MAX_LENGTH,
  type TBoardQuery,
} from "@feeblo/domain-contracts/board-query";
import { SavedViewId } from "@feeblo/id";
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
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import type { SavedViewCollection } from "./board-view-tabs";

/**
 * The row being edited, when the dialog is renaming rather than saving.
 *
 * The stored query is deliberately absent: a rename must not be able to
 * re-filter a view, so an edit passes the view's own query through the same
 * `query` prop a save passes the board's live filters through. The caller knows
 * which of the two applies; the dialog only writes what it is handed.
 */
export type SavedViewTarget = {
  description: string | null;
  id: string;
  name: string;
};

const savedViewFormSchema = z.object({
  description: z
    .string()
    .trim()
    .max(SAVED_VIEW_DESCRIPTION_MAX_LENGTH)
    // Blank is "no description", stored as null; one spelling in the row.
    .transform((value) => (value === "" ? null : value)),
  name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX_LENGTH),
});

/**
 * Creates a view, or updates one, and names it.
 *
 * One dialog for both writes because they ask the same question. Which write
 * happens is decided by `target`, and the query is a prop the caller supplies:
 * "save this board as the view" passes the live filters, the pill menu's "edit"
 * passes the view's own stored query.
 *
 * The parent re-keys this on open (`key={...}`), so `useAppForm`'s defaults are
 * read from the target being edited rather than from whenever the dialog first
 * mounted.
 */
export function SavedViewDialog({
  boardId,
  boardSlug,
  collection,
  memberId,
  nextOrderIndex,
  onOpenChange,
  open,
  organizationId,
  query,
  target,
}: {
  boardId: string | null;
  /** Set on the board surface; absent on the organization-wide feedback list. */
  boardSlug: string | undefined;
  collection: SavedViewCollection;
  memberId: string | undefined;
  /** Where a newly created view lands; the server assigns the stored value. */
  nextOrderIndex: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
  /** What the saved row will hold. */
  query: TBoardQuery;
  /** Absent ⇒ create. */
  target: SavedViewTarget | undefined;
}) {
  const navigate = useNavigate();

  const form = useAppForm({
    defaultValues: {
      description: target?.description ?? "",
      name: target?.name ?? "",
    },
    validators: { onSubmit: savedViewFormSchema },
    onSubmit: async ({ value }) => {
      if (!memberId) {
        toastManager.add({
          title: "Only workspace members can save a view",
          type: "error",
        });
        return;
      }

      // The draft proxy takes mutable values while the persisted query decodes
      // to readonly arrays, so the row gets its own copies. Deliberately left
      // unannotated: annotating it as `TBoardQuery` would reintroduce the
      // readonly arrays the copy exists to avoid.
      const writableQuery = {
        filters: {
          ...query.filters,
          assigneeMemberIds: [...query.filters.assigneeMemberIds],
          statuses: [...query.filters.statuses],
          tagIds: [...query.filters.tagIds],
        },
        ordering: { ...query.ordering },
      };

      try {
        if (target) {
          const transaction = collection.update(target.id, (draft) => {
            draft.description = value.description;
            draft.name = value.name;
            draft.query = writableQuery;
          });
          await transaction.when("settled");

          form.reset();
          onOpenChange(false);
          toastManager.add({
            title: `Updated "${value.name}"`,
            type: "success",
          });
          return;
        }

        const viewId = await SavedViewId.unsafeGenerate();
        const transaction = collection.insert({
          boardId,
          createdAt: new Date(),
          description: value.description,
          id: viewId,
          memberId,
          name: value.name,
          orderIndex: nextOrderIndex,
          organizationId,
          query: writableQuery,
          updatedAt: new Date(),
        });
        await transaction.when("settled");

        form.reset();
        onOpenChange(false);
        toastManager.add({ title: `Saved "${value.name}"`, type: "success" });

        // Land on the view's own path, so the URL names what is on screen and
        // a reload comes back to it.
        if (boardSlug) {
          await navigate({
            params: { boardSlug, organizationId, viewId },
            to: "/$organizationId/board/$boardSlug/view/$viewId",
          });
        } else {
          await navigate({
            params: { organizationId, viewId },
            to: "/$organizationId/feedback/view/$viewId",
          });
        }
      } catch {
        toastManager.add({ title: "Failed to save view", type: "error" });
      }
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{target ? "Edit view" : "New view"}</DialogTitle>
          <DialogDescription>
            {target
              ? "Changes the view's name and description. Its filters stay as they are."
              : "Saves this board's filters and ordering under a name you can come back to."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogPanel className="grid gap-4">
            <form.AppField name="name">
              {(field) => <field.TextField label="Name" />}
            </form.AppField>
            <form.AppField name="description">
              {(field) => (
                <field.TextareaField
                  label="Description"
                  placeholder="What this view is for (optional)"
                  rows={3}
                />
              )}
            </form.AppField>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              Cancel
            </DialogClose>
            <form.AppForm>
              <form.SubscribeButton label="Save" />
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
