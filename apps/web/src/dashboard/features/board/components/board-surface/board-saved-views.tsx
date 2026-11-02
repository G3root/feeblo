import { KeyboardSensor, PointerSensor } from "@dnd-kit/dom";
import { type DragDropEventHandlers, DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import type { TBoardQuery } from "@feeblo/domain-contracts/board-query";
import type { TSavedView } from "@feeblo/domain/saved-view/schema";
import { Button } from "@feeblo/ui/button";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@feeblo/ui/context-menu";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { toastManager } from "@feeblo/ui/toast";
import { toggleVariants } from "@feeblo/ui/toggle";
import { cn } from "@feeblo/ui/utils";
import {
  Add01Icon,
  ArrowDown01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit01Icon,
  MoreHorizontalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import {
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useCurrentMemberId } from "~/hooks/use-current-member-id";
import { savedViewCollectionFor } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

import {
  useBoardOrdering,
  useBoardStore,
} from "../../state/board-store-context";
import { SavedViewDialog, type SavedViewTarget } from "./saved-view-dialog";

export type SavedViewCollection = ReturnType<typeof savedViewCollectionFor>;

type SavedViewActions = {
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
};

/**
 * The pointer sensor's defaults suppress activation on an interactive
 * descendant, so a pill can be both a link and a drag source only when the
 * draggable node is the anchor itself — which is why `element` is named here.
 * A press has to survive the delay and travel before a drag starts, so a click
 * still navigates.
 */
const sensors = [
  PointerSensor.configure({
    activatorElements(source) {
      return [source.element];
    },
  }),
  KeyboardSensor,
];

/**
 * A surface's saved views, as pills beside the built-in ones.
 *
 * Two constraints shape this component:
 *
 * 1. The row must not push the toolbar's search and filter controls off
 *    screen, so it clips and reports what it clipped ("3 more"). Overflowing
 *    pills stay in the DOM and are hidden with `visibility`, not unmounted:
 *    their layout is what the measuring pass reads on the next resize, so
 *    removing them would make the count impossible to recover.
 * 2. On a phone the row is `display: none` (its `sm:flex` breakpoint), which
 *    reports a zero width — so every pill counts as clipped and the same button
 *    carries them all. One mechanism, no media query in JavaScript.
 */
export function BoardSavedViews({
  boardId,
  boardSlug,
  organizationId,
}: {
  boardId: string | null;
  boardSlug: string | undefined;
  organizationId: string;
}) {
  const collection = useMemo(
    () => savedViewCollectionFor(organizationId, boardId),
    [organizationId, boardId]
  );
  const memberId = useCurrentMemberId(organizationId);

  const { data } = useLiveQuery({
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
      [...(data ?? [])].sort(
        (left, right) =>
          left.orderIndex - right.orderIndex ||
          left.createdAt.getTime() - right.createdAt.getTime()
      ),
    [data]
  );

  const store = useBoardStore();
  const filters = useSelector(
    store,
    (state) => state.context.activeView.filters
  );
  const activeViewId = useSelector(
    store,
    (state) => state.context.activeView.id
  );
  const ordering = useBoardOrdering();
  const currentQuery: TBoardQuery = { filters, ordering };
  const appliedView = rows.find((view) => view.id === activeViewId);

  /**
   * The order the row shows between a drop and the server confirming it.
   *
   * A reorder cannot ride the collection's own `onUpdate` — that path writes a
   * view's name, description and query, not its position — so the drop is sent
   * as one `ReorderSavedViews` call and the row keeps the dropped order until
   * the refetch lands.
   */
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const ordered = useMemo(() => {
    if (pendingOrder === null) {
      return rows;
    }
    const byId = new Map(rows.map((view) => [view.id, view]));

    return pendingOrder.flatMap((id) => {
      const row = byId.get(id);

      return row === undefined ? [] : [row];
    });
  }, [pendingOrder, rows]);

  /**
   * How many pills are fully visible. Only the "N more" label depends on it:
   * clipping already hides the rest, and the pills stay laid out so the next
   * measurement can still see them.
   */
  const [visibleCount, setVisibleCount] = useState(rows.length);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;

    if (!row) {
      return undefined;
    }

    const measure = () => setVisibleCount(countFullyVisible(row));

    // `ResizeObserver` reports the row's own box only, so a drag's transforms
    // and this component's re-renders never re-trigger it — which is the guard
    // against the measure/set-state loop it would otherwise be.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);

    return () => observer.disconnect();
  }, [rows.length]);

  const overflowCount = Math.max(ordered.length - visibleCount, 0);

  const commitOrder = async (orderedIds: string[]) => {
    setPendingOrder(orderedIds);

    try {
      await fetchRpc((rpc) =>
        rpc.ReorderSavedViews({ boardId, orderedIds, organizationId })
      );
      await collection.utils.refetch();
    } catch {
      toastManager.add({ title: "Failed to reorder views", type: "error" });
    } finally {
      setPendingOrder(null);
    }
  };

  const handleDragEnd = ((
    event: Parameters<DragDropEventHandlers["onDragEnd"]>[0]
  ) => {
    if (event.canceled) {
      return;
    }
    const { source } = event.operation;

    // The sortable plugin reorders as the pointer moves and writes the
    // destination into the source's own `index`; at drop time `target` is the
    // source again, so the two indices are the whole answer.
    if (
      !source ||
      !isSortable(source) ||
      source.initialIndex === source.index
    ) {
      return;
    }

    const ids = ordered.map((view) => view.id);
    const [moved] = ids.splice(source.initialIndex, 1);

    if (moved === undefined) {
      return;
    }
    ids.splice(source.index, 0, moved);
    void commitOrder(ids);
  }) satisfies DragDropEventHandlers["onDragEnd"];

  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const closeDialog = () => setDialog({ kind: "closed" });

  /**
   * "Save changes" targets the view the board is showing, so it replaces that
   * view instead of saving a duplicate. "New view" always creates, which keeps
   * a way out of the applied view.
   */
  const target =
    dialog.kind === "edit"
      ? dialog.view
      : dialog.kind === "save" && appliedView !== undefined
        ? appliedView
        : undefined;
  // Editing renames; saving re-filters. The dialog writes what it is handed.
  const dialogQuery = dialog.kind === "edit" ? dialog.view.query : currentQuery;

  const actionsFor = (view: TSavedView): SavedViewActions => ({
    onCopy: () => void copyViewLink({ boardSlug, organizationId, view }),
    onDelete: () => void deleteView(collection, view),
    onEdit: () => setDialog({ kind: "edit", view }),
  });

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <DragDropProvider onDragEnd={handleDragEnd} sensors={sensors}>
          <div
            className="hidden min-w-0 items-center gap-2 overflow-hidden sm:flex"
            ref={rowRef}
          >
            {ordered.map((view, index) => (
              <SavedViewPill
                actions={actionsFor(view)}
                boardSlug={boardSlug}
                index={index}
                isClipped={index >= visibleCount}
                key={view.id}
                organizationId={organizationId}
                view={view}
              />
            ))}
          </div>
        </DragDropProvider>

        <Button
          className="shrink-0 rounded-full"
          onClick={() =>
            setDialog(appliedView ? { kind: "save" } : { kind: "create" })
          }
          size="sm"
          type="button"
          variant={appliedView ? "secondary" : "outline"}
        >
          <HugeiconsIcon icon={appliedView ? Tick02Icon : Add01Icon} />
          {appliedView ? "Save changes" : "New view"}
        </Button>

        {overflowCount > 0 ? (
          <SavedViewsPopover
            actionsFor={actionsFor}
            boardSlug={boardSlug}
            onCreate={() => setDialog({ kind: "create" })}
            organizationId={organizationId}
            overflowCount={overflowCount}
            views={ordered}
          />
        ) : null}
      </div>

      <SavedViewDialog
        // `useAppForm` reads its defaults at mount, so the dialog is re-keyed
        // per open and target rather than holding the first one it saw.
        key={dialog.kind === "edit" ? `edit:${dialog.view.id}` : dialog.kind}
        boardId={boardId}
        boardSlug={boardSlug}
        collection={collection}
        memberId={memberId}
        nextOrderIndex={rows.length}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        open={dialog.kind !== "closed"}
        organizationId={organizationId}
        query={dialogQuery}
        target={target === undefined ? undefined : toTarget(target)}
      />
    </>
  );
}

type DialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "save" }
  | { kind: "edit"; view: TSavedView };

const toTarget = (view: TSavedView): SavedViewTarget => ({
  description: view.description,
  id: view.id,
  name: view.name,
});

/**
 * The number of pills whose right edge falls inside the row's visible box.
 *
 * Measured rather than computed from a fixed budget because a pill's width is
 * its name's width. A pill that is only partly inside the box is *not* counted:
 * the row would otherwise show a half-clipped pill at its edge.
 */
const countFullyVisible = (row: HTMLElement): number => {
  if (row.clientWidth === 0) {
    return 0;
  }
  const rowLeft = row.getBoundingClientRect().left;
  let fitting = 0;

  for (const child of Array.from(row.children)) {
    if (child.getBoundingClientRect().right - rowLeft > row.clientWidth + 0.5) {
      break;
    }
    fitting += 1;
  }

  return fitting;
};

/** The view's own path, so a link to it survives a reload. */
const savedViewPath = ({
  boardSlug,
  organizationId,
  viewId,
}: {
  boardSlug: string | undefined;
  organizationId: string;
  viewId: string;
}) =>
  boardSlug
    ? `/${organizationId}/board/${boardSlug}/view/${viewId}`
    : `/${organizationId}/feedback/view/${viewId}`;

/**
 * A link to a saved view, on whichever surface it belongs to.
 *
 * One component rather than a link per call site: the two route ids are
 * different literals, so the branch has to exist somewhere, and spreading a
 * union of `{ to, params }` pairs onto `Link` is not assignable — its props are
 * a union discriminated on `to`.
 */
function SavedViewLink({
  activeOptions,
  activeProps,
  boardSlug,
  children,
  className,
  onClick,
  organizationId,
  ref,
  viewId,
}: {
  activeOptions?: { exact: boolean };
  activeProps?: Record<string, string>;
  boardSlug: string | undefined;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  organizationId: string;
  ref?: Ref<HTMLAnchorElement>;
  viewId: string;
}) {
  if (boardSlug) {
    return (
      <Link
        activeOptions={activeOptions}
        activeProps={activeProps}
        className={className}
        onClick={onClick}
        params={{ boardSlug, organizationId, viewId }}
        ref={ref}
        to="/$organizationId/board/$boardSlug/view/$viewId"
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      activeOptions={activeOptions}
      activeProps={activeProps}
      className={className}
      onClick={onClick}
      params={{ organizationId, viewId }}
      ref={ref}
      to="/$organizationId/feedback/view/$viewId"
    >
      {children}
    </Link>
  );
}

/**
 * One pill: a link to the view's path, a drag source, and a context menu.
 *
 * The three interactions share one element because they are three gestures on
 * the same target: click navigates, press-and-move reorders, right-click opens
 * the actions. `draggable={false}` keeps the browser's own link drag from
 * competing with the sortable one.
 */
function SavedViewPill({
  actions,
  boardSlug,
  index,
  isClipped,
  organizationId,
  view,
}: {
  actions: SavedViewActions;
  boardSlug: string | undefined;
  index: number;
  isClipped: boolean;
  organizationId: string;
  view: TSavedView;
}) {
  const { isDragging, ref } = useSortable({ id: view.id, index });

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          "shrink-0",
          // `invisible` keeps the pill's layout, so the next measurement still
          // sees its width and can bring it back when the row grows.
          isClipped && "invisible",
          isDragging && "z-10 opacity-80"
        )}
      >
        <SavedViewLink
          activeOptions={{ exact: true }}
          activeProps={{ "data-pressed": "true" }}
          boardSlug={boardSlug}
          className={cn(
            toggleVariants({ size: "sm", variant: "outline" }),
            "cursor-grab active:cursor-grabbing"
          )}
          organizationId={organizationId}
          ref={ref}
          viewId={view.id}
        >
          <span className="max-w-40 truncate">{view.name}</span>
        </SavedViewLink>
      </ContextMenuTrigger>
      <ContextMenuPopup align="start">
        <ContextMenuItem onClick={actions.onEdit}>
          <HugeiconsIcon icon={Edit01Icon} />
          Edit
        </ContextMenuItem>
        <ContextMenuItem onClick={actions.onCopy}>
          <HugeiconsIcon icon={Copy01Icon} />
          Copy link
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={actions.onDelete} variant="destructive">
          <HugeiconsIcon icon={Delete02Icon} />
          Delete
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}

/**
 * The overflow button: a count, a way to create, and the full list.
 *
 * It lists every view, not only the clipped ones. On a phone it is the only
 * affordance, so "what I clipped" and "what I have" have to be the same list —
 * and the count in the header is the surface's total, which is what the label
 * on the button promises.
 */
function SavedViewsPopover({
  actionsFor,
  boardSlug,
  onCreate,
  organizationId,
  overflowCount,
  views,
}: {
  actionsFor: (view: TSavedView) => SavedViewActions;
  boardSlug: string | undefined;
  onCreate: () => void;
  organizationId: string;
  overflowCount: number;
  views: readonly TSavedView[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            className="shrink-0 rounded-full"
            size="sm"
            variant="outline"
          />
        }
      >
        <HugeiconsIcon icon={ArrowDown01Icon} />
        {overflowCount} more
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-72">
        <div className="px-1 pb-2">
          <span className="text-sm font-medium">
            {views.length} {views.length === 1 ? "view" : "views"}
          </span>
        </div>
        <Button
          className="w-full justify-start"
          onClick={() => {
            setOpen(false);
            onCreate();
          }}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon icon={Add01Icon} />
          New view
        </Button>
        <ul className="mt-2 flex flex-col gap-0.5">
          {views.map((view) => (
            <SavedViewPopoverRow
              actions={actionsFor(view)}
              boardSlug={boardSlug}
              key={view.id}
              onNavigate={() => setOpen(false)}
              organizationId={organizationId}
              view={view}
            />
          ))}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}

function SavedViewPopoverRow({
  actions,
  boardSlug,
  onNavigate,
  organizationId,
  view,
}: {
  actions: SavedViewActions;
  boardSlug: string | undefined;
  onNavigate: () => void;
  organizationId: string;
  view: TSavedView;
}) {
  return (
    <li className="hover:bg-accent/60 flex items-center gap-1 rounded-md">
      <SavedViewLink
        boardSlug={boardSlug}
        className="min-w-0 flex-1 px-2 py-1.5"
        onClick={onNavigate}
        organizationId={organizationId}
        viewId={view.id}
      >
        <span className="block truncate text-sm font-medium">{view.name}</span>
        {view.description ? (
          <span className="text-muted-foreground block truncate text-xs">
            {view.description}
          </span>
        ) : null}
      </SavedViewLink>
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={`Actions for ${view.name}`}
              className="shrink-0"
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={actions.onEdit}>
            <HugeiconsIcon icon={Edit01Icon} />
            Edit
          </MenuItem>
          <MenuItem onClick={actions.onCopy}>
            <HugeiconsIcon icon={Copy01Icon} />
            Copy link
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={actions.onDelete} variant="destructive">
            <HugeiconsIcon icon={Delete02Icon} />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}

const copyViewLink = async ({
  boardSlug,
  organizationId,
  view,
}: {
  boardSlug: string | undefined;
  organizationId: string;
  view: TSavedView;
}) => {
  const url = `${window.location.origin}${savedViewPath({
    boardSlug,
    organizationId,
    viewId: view.id,
  })}`;

  try {
    await navigator.clipboard.writeText(url);
    toastManager.add({ title: "View link copied", type: "success" });
  } catch {
    toastManager.add({ title: "Failed to copy link", type: "error" });
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
