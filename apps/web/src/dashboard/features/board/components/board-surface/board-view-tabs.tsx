import {
  BOARD_QUERY_VERSION,
  type TBoardQuery,
} from "@feeblo/domain-contracts/board-query";
import type { TSavedView } from "@feeblo/domain/saved-view/schema";
import { SavedViewId } from "@feeblo/id";
import { toastManager } from "@feeblo/ui/toast";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useCallback, useMemo, useState } from "react";

import { useCurrentMemberId } from "~/hooks/use-current-member-id";
import { savedViewCollectionFor } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

import { useBoardStore } from "../../state/board-store-context";
import { ViewTabStrip } from "./board-view-tab-strip";
import {
  SavedViewSheet,
  type SavedViewSaved,
  type SavedViewTarget,
} from "./saved-view-sheet";

export type SavedViewCollection = ReturnType<typeof savedViewCollectionFor>;

type SheetState =
  | { kind: "closed" }
  | { kind: "create"; query: TBoardQuery }
  | { kind: "edit"; query: TBoardQuery; view: TSavedView };

/**
 * The board's view tabs: data and writes for the strip that renders them.
 *
 * Split from `ViewTabStrip` on purpose. This component owns what changes when a
 * view is created, edited, deleted or reordered — the collection, the sheet,
 * the mutations — and the strip owns what changes while the toolbar is being
 * measured (the visible count, the pending drag order). Keeping them in one
 * component meant every measurement or popover toggle re-rendered the sheet's
 * form and every pill's menus with it.
 *
 * The board's filters are read from the store snapshot when a create sheet
 * opens, and from the row when an edit sheet opens; neither is a subscription.
 * The tab strip has no business re-rendering while somebody types in the search
 * box, and a new view is saved with the query as it was when the member asked
 * for it.
 */
export function BoardViewTabs({
  boardId,
  boardSlug,
  organizationId,
  variant,
}: {
  boardId: string | null;
  boardSlug: string | undefined;
  organizationId: string;
  variant: "board" | "feedback";
}) {
  const memberId = useCurrentMemberId(organizationId);
  const collection = useMemo(
    () => savedViewCollectionFor(organizationId, boardId, memberId),
    [organizationId, boardId, memberId]
  );
  const store = useBoardStore();

  const { data, isLoadingError } = useLiveQuery({
    queryKey: ["saved-views", collection.id, organizationId],
    query: (q) =>
      q
        .from({ view: collection })
        .where(({ view }) => eq(view.organizationId, organizationId)),
  });
  // Sorted here rather than trusted from the read: a collection is a set, so
  // the array a `queryFn` returned is not an ordering the live query promises
  // to keep. `orderIndex` is what the drag rewrites and `createdAt` breaks the
  // tie two rows can share when a create raced another on the same surface.
  const rows = useMemo(
    () =>
      (data ?? []).toSorted(
        (left, right) =>
          left.orderIndex - right.orderIndex ||
          left.createdAt.getTime() - right.createdAt.getTime()
      ),
    [data]
  );

  // The active view's id only. A selector on this string re-renders the strip
  // when the route's view changes, not on every filter keystroke.
  const activeViewId = useSelector(
    store,
    (state) => state.context.activeView.id
  );

  const [sheet, setSheet] = useState<SheetState>({ kind: "closed" });
  const closeSheet = useCallback(() => setSheet({ kind: "closed" }), []);

  // `reload()` retries the source that failed while keeping the rows already on
  // screen, which is the recovery a failed first load has.
  const retrySavedViews = useCallback(() => {
    void collection.reload().catch(() => undefined);
  }, [collection]);

  const openCreate = useCallback(() => {
    const { activeView, grouping, ordering } = store.getSnapshot().context;

    setSheet({
      kind: "create",
      query: {
        version: BOARD_QUERY_VERSION,
        filters: activeView.filters,
        grouping,
        ordering,
      },
    });
  }, [store]);

  const editView = useCallback(
    (view: TSavedView) =>
      // Editing can rewrite the filters, grouping and ordering, so the sheet
      // starts from the view's own query rather than from the board's live one.
      setSheet({ kind: "edit", query: view.query, view }),
    []
  );

  /**
   * Applies a saved row to the board when it is the view on screen.
   *
   * The board store is seeded once per surface, so editing the active view
   * would otherwise persist a new query while leaving the result set showing
   * the old one until a reload. A different view's edit must not move the
   * board the member is currently looking at.
   */
  const applySavedView = useCallback(
    (saved: SavedViewSaved) => {
      if (saved.id !== activeViewId) {
        return;
      }

      if (!saved.queryChanged) {
        // A rename or a description change does not change the result set, so
        // the board keeps its live query — including any local edit made after
        // the sheet opened.
        store.send({ type: "renameActiveView", name: saved.name });
        return;
      }

      store.send({
        type: "setActiveView",
        grouping: saved.grouping,
        ordering: saved.ordering,
        view: { filters: saved.filters, id: saved.id, name: saved.name },
      });
    },
    [activeViewId, store]
  );

  const removeView = useCallback(
    (view: TSavedView) => void deleteView(collection, view),
    [collection]
  );

  const copyView = useCallback(
    (view: TSavedView) =>
      void duplicateView({
        collection,
        memberId,
        // Names are not unique, so the copy keeps the original's: duplicating is
        // "give me another one of these", and an invented suffix would make the
        // two hard to tell apart in the very list they are compared in.
        name: view.name,
        orderIndex: rows.length,
        view,
      }),
    [collection, memberId, rows.length]
  );

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      await fetchRpc((rpc) =>
        rpc.ReorderSavedViews({ boardId, orderedIds, organizationId })
      );
      await collection.utils.refetch();
    },
    [boardId, collection, organizationId]
  );

  const target = sheet.kind === "edit" ? sheet.view : undefined;

  return (
    <>
      <ViewTabStrip
        activeViewId={activeViewId}
        boardSlug={boardSlug}
        currentMemberId={memberId}
        onCreate={openCreate}
        onDelete={removeView}
        onDuplicate={copyView}
        onEdit={editView}
        onReorder={reorder}
        onRetrySavedViews={isLoadingError ? retrySavedViews : undefined}
        organizationId={organizationId}
        rows={isLoadingError ? [] : rows}
        variant={variant}
      />

      {/* Mounted only while open: `useAppForm` reads its defaults at mount, so
          each open starts from the target it was opened for instead of the
          first one the sheet ever saw — and a closed sheet holds no form state
          to keep in sync. */}
      {sheet.kind === "closed" ? null : (
        <SavedViewSheet
          boardId={boardId}
          boardSlug={boardSlug}
          collection={collection}
          memberId={memberId}
          nextOrderIndex={rows.length}
          onOpenChange={(open) => {
            if (!open) {
              closeSheet();
            }
          }}
          onSaved={applySavedView}
          open
          organizationId={organizationId}
          query={sheet.query}
          target={target === undefined ? undefined : toTarget(target)}
        />
      )}
    </>
  );
}

const toTarget = (view: TSavedView): SavedViewTarget => ({
  description: view.description,
  id: view.id,
  isPrivate: view.isPrivate,
  name: view.name,
});

/**
 * Copies a view: same name, same query, same description, a new row at the end.
 *
 * Deliberately does not navigate. Duplicating from a pill's menu is a "keep this
 * one and make me another" move, and pulling the board to the copy would be a
 * context switch the member did not ask for; the toast names what was created
 * and the new tab appears at the end of the strip.
 */
const duplicateView = async ({
  collection,
  memberId,
  name,
  orderIndex,
  view,
}: {
  collection: SavedViewCollection;
  memberId: string | undefined;
  name: string;
  orderIndex: number;
  view: TSavedView;
}) => {
  if (!memberId) {
    toastManager.add({
      title: "Only workspace members can duplicate a view",
      type: "error",
    });
    return;
  }

  try {
    const id = await SavedViewId.unsafeGenerate();
    const transaction = collection.insert({
      boardId: view.boardId,
      createdAt: new Date(),
      description: view.description,
      id,
      isPrivate: view.isPrivate,
      memberId,
      name,
      orderIndex,
      organizationId: view.organizationId,
      query: view.query,
      updatedAt: new Date(),
    });

    await transaction.when("settled");
    toastManager.add({ title: `Duplicated "${name}"`, type: "success" });
  } catch {
    toastManager.add({ title: "Failed to duplicate view", type: "error" });
  }
};

const deleteView = async (
  collection: SavedViewCollection,
  view: TSavedView
) => {
  try {
    const transaction = collection.delete(view.id);
    await transaction.when("settled");
    toastManager.add({ title: `Deleted "${view.name}"`, type: "success" });
  } catch {
    toastManager.add({ title: "Failed to delete view", type: "error" });
  }
};
