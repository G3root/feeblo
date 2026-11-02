import {
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
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import {
  Bookmark02Icon,
  BookmarkAdd02Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { useCurrentMemberId } from "~/hooks/use-current-member-id";
import { savedViewCollectionFor } from "~/lib/collections";

import { type BoardView, useBoardStore } from "../../state/board-store-context";

/**
 * Save, apply, and delete the member's own board queries.
 *
 * A saved view is the board's current filters plus its ordering, stored per
 * member and per surface (the feedback list or one board). Applying one sets
 * the store's `activeView`, which is the same event the route tabs use, so a
 * saved view narrows the board through the one path a built-in view does — no
 * separate "saved" query mode to keep in sync with the filter predicates.
 *
 * The view is client state, not URL state: navigating to another route resets
 * the board to that route's view, and a saved view has to be re-applied. That
 * matches the built-in presets, which are also lost when you leave the page
 * that carries them.
 */
export function BoardViewsMenu({
  boardId,
  organizationId,
}: {
  boardId: string | null;
  organizationId: string;
}) {
  const store = useBoardStore();
  const currentMemberId = useCurrentMemberId(organizationId);
  const activeView = useSelector(store, (state) => state.context.activeView);
  const [isSaveOpen, setSaveOpen] = useState(false);

  const collection = useMemo(
    () => savedViewCollectionFor(organizationId, boardId),
    [organizationId, boardId]
  );

  const { data: savedViews } = useLiveQuery({
    queryKey: ["saved-views", collection.id, organizationId],
    query: (q) =>
      q
        .from({ view: collection })
        .where(({ view }) => eq(view.organizationId, organizationId)),
  });

  const views = savedViews ?? [];
  const appliedView = views.find((view) => view.id === activeView.id);

  const applyView = (view: (typeof views)[number]) => {
    const boardView: BoardView = {
      filters: view.query.filters,
      id: view.id,
      name: view.name,
    };

    store.send({
      type: "setActiveView",
      ordering: view.query.ordering,
      view: boardView,
    });
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={
                appliedView ? `Saved views: ${appliedView.name}` : "Saved views"
              }
              className="max-w-40 rounded-full"
              size={appliedView ? "sm" : "icon-sm"}
              variant={appliedView ? "secondary" : "outline"}
            />
          }
        >
          <HugeiconsIcon icon={Bookmark02Icon} />
          {appliedView ? (
            // `min-w-0` is what lets the label shrink inside the button's flex
            // row on a phone; without it `truncate` never engages.
            <span className="min-w-0 truncate">{appliedView.name}</span>
          ) : null}
        </MenuTrigger>
        <MenuPopup align="start" className="w-64">
          <MenuGroup>
            {views.length === 0 ? (
              <MenuItem disabled>No saved views yet</MenuItem>
            ) : (
              views.map((view) => (
                <MenuItem key={view.id} onClick={() => applyView(view)}>
                  <span className="truncate">{view.name}</span>
                </MenuItem>
              ))
            )}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem onClick={() => setSaveOpen(true)}>
            <HugeiconsIcon icon={BookmarkAdd02Icon} />
            Save current view
          </MenuItem>
          {views.length > 0 ? (
            <MenuSub>
              <MenuSubTrigger>
                <HugeiconsIcon icon={Delete02Icon} />
                Delete a view
              </MenuSubTrigger>
              <MenuSubPopup>
                {views.map((view) => (
                  <MenuItem
                    key={view.id}
                    onClick={() => {
                      void deleteView(collection, view.id, view.name);
                    }}
                    variant="destructive"
                  >
                    <span className="truncate">{view.name}</span>
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
          ) : null}
        </MenuPopup>
      </Menu>

      <SaveViewDialog
        // The form's default name is the active view's, and `useAppForm` reads
        // its defaults at mount. Re-keying on the active view is what keeps
        // "save" from offering the name of the view that was applied before
        // this one.
        key={activeView.id}
        boardId={boardId}
        collection={collection}
        memberId={currentMemberId}
        onOpenChange={setSaveOpen}
        open={isSaveOpen}
        organizationId={organizationId}
        savedView={appliedView}
      />
    </>
  );
}

type SavedViewCollection = ReturnType<typeof savedViewCollectionFor>;

async function deleteView(
  collection: SavedViewCollection,
  id: string,
  name: string
) {
  try {
    const transaction = collection.delete(id);
    await transaction.when("settled");
    toastManager.add({ title: `Deleted "${name}"`, type: "success" });
  } catch {
    toastManager.add({ title: "Failed to delete view", type: "error" });
  }
}

/**
 * Names the view being saved and stores the board's current query under it.
 *
 * Saving while a saved view is applied *updates that view* rather than adding a
 * second row: the name field is prefilled with it, the dialog says so, and the
 * unique constraint on (member, board, name) would reject the duplicate anyway.
 * To branch off a new view instead, apply a built-in tab first — that clears the
 * applied view, so the dialog goes back to creating one.
 */
function SaveViewDialog({
  boardId,
  collection,
  memberId,
  onOpenChange,
  open,
  organizationId,
  savedView,
}: {
  boardId: string | null;
  collection: SavedViewCollection;
  memberId: string | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
  /** The applied saved view, when the board is showing one. */
  savedView: { id: string; name: string } | undefined;
}) {
  const store = useBoardStore();
  const activeView = useSelector(store, (state) => state.context.activeView);
  const filters = useSelector(
    store,
    (state) => state.context.activeView.filters
  );
  const ordering = useSelector(store, (state) => state.context.ordering);

  const form = useAppForm({
    defaultValues: { name: activeView.name },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX_LENGTH),
      }),
    },
    onSubmit: async (data) => {
      if (!memberId) {
        toastManager.add({
          title: "Only workspace members can save a view",
          type: "error",
        });
        return;
      }

      const query: TBoardQuery = { filters, ordering };
      const name = data.value.name;

      try {
        // The id the board will keep pointing at: the applied view's when this
        // write replaces one, a fresh one when it creates a view.
        const viewId = savedView?.id ?? (await SavedViewId.unsafeGenerate());
        const transaction = savedView
          ? collection.update(savedView.id, (draft) => {
              draft.name = name;
              // The draft proxy takes mutable values while the persisted query
              // decodes to readonly arrays, so the row gets its own copies
              // rather than the store's objects.
              draft.query = {
                filters: {
                  ...filters,
                  assigneeMemberIds: [...filters.assigneeMemberIds],
                  statuses: [...filters.statuses],
                  tagIds: [...filters.tagIds],
                },
                ordering: { ...ordering },
              };
            })
          : collection.insert({
              boardId,
              createdAt: new Date(),
              id: viewId,
              memberId,
              name,
              organizationId,
              query,
              updatedAt: new Date(),
            });

        await transaction.when("settled");
        // Re-point the active view at the record just written, so the
        // toolbar's label follows a rename instead of showing the old name.
        store.send({
          type: "setActiveView",
          view: { filters, id: viewId, name },
        });
        form.reset();
        onOpenChange(false);
        toastManager.add({
          title: savedView ? `Updated "${name}"` : `Saved "${name}"`,
          type: "success",
        });
      } catch {
        toastManager.add({ title: "Failed to save view", type: "error" });
      }
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{savedView ? "Update view" : "Save view"}</DialogTitle>
          <DialogDescription>
            {savedView
              ? `Replaces the filters and ordering stored in "${savedView.name}".`
              : "Saves this board's filters and ordering under a name you can apply again later."}
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
