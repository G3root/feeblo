import {
  normalizeBoardQuery,
  SAVED_VIEW_DESCRIPTION_MAX_LENGTH,
  SAVED_VIEW_NAME_MAX_LENGTH,
  type TBoardFilters,
  type TBoardGroupBy,
  type TBoardGrouping,
  type TBoardOrdering,
  type TBoardQuery,
} from "@feeblo/domain-contracts/board-query";
import { SavedViewId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { Checkbox } from "@feeblo/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@feeblo/ui/field";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { BoardFilter } from "./board-filter";
import type { SavedViewCollection } from "./board-view-tabs";
import {
  SavedViewFilterSummary,
  SavedViewGroupingSummary,
  SavedViewOrderSummary,
} from "./saved-view-filter-summary";

/**
 * The row being edited, when the sheet is updating rather than creating.
 *
 * It carries the descriptive fields only. The query is a prop for both modes:
 * create passes the board's live filters, edit passes the view's stored query
 * as the starting point for the editor, and the save writes the draft.
 */
export type SavedViewTarget = {
  description: string | null;
  id: string;
  isPrivate: boolean;
  name: string;
};

/** The row as it was just written, so the caller can apply it to the board. */
export type SavedViewSaved = {
  filters: TBoardFilters;
  grouping: TBoardGrouping;
  id: string;
  name: string;
  ordering: TBoardOrdering;
  /**
   * Whether the save changed the stored query. A rename or a description edit
   * leaves the board's filters, grouping and ordering alone; only a query
   * change moves the surface the member is looking at.
   */
  queryChanged: boolean;
};

const savedViewFormSchema = z.object({
  description: z
    .string()
    .trim()
    .max(SAVED_VIEW_DESCRIPTION_MAX_LENGTH)
    // Blank is "no description", stored as null; one spelling in the row.
    .transform((value) => (value === "" ? null : value)),
  isPrivate: z.boolean(),
  name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX_LENGTH),
});

/**
 * Creates a view, or updates one, and names it.
 *
 * One sheet for both writes because they ask the same question. Which write
 * happens is decided by `target`, and the query is a prop the caller supplies:
 * "save this board as the view" passes the live filters, the pill menu's "edit"
 * passes the view's own stored query as the editor's initial value. The edit
 * sheet can then rewrite that query without touching the board behind it.
 *
 * The parent mounts this only while open, so `useAppForm`'s defaults and the
 * draft filters are both read from the target being edited rather than from
 * whenever the sheet first mounted.
 */
export function SavedViewSheet({
  boardId,
  boardSlug,
  collection,
  memberId,
  nextOrderIndex,
  onOpenChange,
  onSaved,
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
  /** Called after the row is written, so the caller can apply it to the board. */
  onSaved?: (view: SavedViewSaved) => void;
  open: boolean;
  organizationId: string;
  /** The stored query, or the live board query when creating. */
  query: TBoardQuery;
  /** Absent ⇒ create. */
  target: SavedViewTarget | undefined;
}) {
  const navigate = useNavigate();
  // The editor's values, not the board's: a member can open an existing view,
  // change its filters or grouping, and cancel without the board moving
  // underneath them.
  const [draftFilters, setDraftFilters] = useState<TBoardFilters>(
    () => query.filters
  );
  const [draftGrouping, setDraftGrouping] = useState<TBoardGrouping>(
    () => query.grouping
  );

  const form = useAppForm({
    defaultValues: {
      description: target?.description ?? "",
      isPrivate: target?.isPrivate ?? false,
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
      const normalized = normalizeBoardQuery({
        version: query.version,
        filters: draftFilters,
        grouping: draftGrouping,
        ordering: query.ordering,
      });
      const writableQuery = {
        filters: {
          assigneeMemberIds:
            normalized.filters.assigneeMemberIds === null
              ? null
              : [...normalized.filters.assigneeMemberIds],
          search: normalized.filters.search,
          status:
            normalized.filters.status === null
              ? null
              : {
                  operator: normalized.filters.status.operator,
                  types: [...normalized.filters.status.types],
                },
          tag:
            normalized.filters.tag === null
              ? null
              : {
                  operator: normalized.filters.tag.operator,
                  tagIds: [...normalized.filters.tag.tagIds],
                },
        },
        grouping: { ...normalized.grouping },
        ordering: { ...normalized.ordering },
        version: normalized.version,
      };
      // The sheet's starting query is the stored one, so a comparison against
      // it separates a real query edit from a rename or description change.
      // Both sides are normalized because a stored row and a live board query
      // spell the same selection in different orders.
      const queryChanged =
        target !== undefined &&
        JSON.stringify(normalizeBoardQuery(query)) !==
          JSON.stringify(normalized);
      // The form starts at the target's mount-time values. Only fields the
      // member actually changed should be written; an untouched field must not
      // send that starting value over a newer row.
      const nameChanged = target !== undefined && target.name !== value.name;
      const isPrivateChanged =
        target !== undefined && target.isPrivate !== value.isPrivate;

      try {
        if (target) {
          const transaction = collection.update(target.id, (draft) => {
            draft.description = value.description;
            if (nameChanged) {
              draft.name = value.name;
            }
            if (isPrivateChanged) {
              draft.isPrivate = value.isPrivate;
            }
            // Only a real query edit writes the query. A rename or description
            // change leaves the row's current query alone, so a row refetched
            // while the sheet was open is not overwritten by the sheet's
            // starting copy.
            if (queryChanged) {
              draft.query = writableQuery;
            }
          });
          await transaction.when("settled");

          form.reset();
          onSaved?.({
            filters: writableQuery.filters,
            grouping: writableQuery.grouping,
            id: target.id,
            name: value.name,
            ordering: writableQuery.ordering,
            queryChanged,
          });
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
          isPrivate: value.isPrivate,
          memberId,
          name: value.name,
          orderIndex: nextOrderIndex,
          organizationId,
          query: writableQuery,
          updatedAt: new Date(),
        });
        await transaction.when("settled");

        form.reset();
        onSaved?.({
          filters: writableQuery.filters,
          grouping: writableQuery.grouping,
          id: viewId,
          name: value.name,
          ordering: writableQuery.ordering,
          queryChanged,
        });
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
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>{target ? "Edit view" : "New view"}</SheetTitle>
          <SheetDescription>
            {target
              ? "Changes the view's name, filters, grouping, description, and who can see it."
              : "Saves the current filters, grouping and ordering under a name you can come back to."}
          </SheetDescription>
        </SheetHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <SheetPanel className="grid gap-4">
            {target ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Filters and grouping</h3>
                <BoardFilter.Editor
                  filters={draftFilters}
                  grouping={draftGrouping}
                  onChange={setDraftFilters}
                  onGroupByChange={(field: TBoardGroupBy) =>
                    setDraftGrouping({ field })
                  }
                  organizationId={organizationId}
                />
                <SavedViewOrderSummary ordering={query.ordering} />
              </section>
            ) : (
              <div className="space-y-2">
                <SavedViewFilterSummary
                  organizationId={organizationId}
                  query={query}
                />
                <SavedViewGroupingSummary grouping={query.grouping} />
                <SavedViewOrderSummary ordering={query.ordering} />
              </div>
            )}
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
            <form.AppField name="isPrivate">
              {(field) => (
                <Field name={field.name} orientation="horizontal">
                  <Checkbox
                    checked={field.state.value}
                    id={field.name}
                    onBlur={field.handleBlur}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                  <div className="grid gap-0.5">
                    <FieldLabel htmlFor={field.name}>Private view</FieldLabel>
                    <FieldDescription>
                      Only you can see a private view. Unchecked, every member
                      of the workspace can see it.
                    </FieldDescription>
                  </div>
                </Field>
              )}
            </form.AppField>
          </SheetPanel>
          <SheetFooter>
            <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
            <form.AppForm>
              <form.SubscribeButton label="Save" />
            </form.AppForm>
          </SheetFooter>
        </form>
      </SheetPopup>
    </Sheet>
  );
}
