import {
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { type DragDropEventHandlers, DragDropProvider } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import type { TSavedView } from "@feeblo/domain/saved-view/schema";
import { Button } from "@feeblo/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { toastManager } from "@feeblo/ui/toast";
import { toggleVariants } from "@feeblo/ui/toggle";
import { cn } from "@feeblo/ui/utils";
import { ArrowDown01Icon, LayersPlusIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  BUILT_IN_VIEW_KEYS,
  BUILT_IN_VIEWS,
  type BuiltInView,
} from "../../lib/built-in-views";
import {
  countFittingTabs,
  OVERFLOW_TAB_BUTTON_MAX_PX,
  OVERFLOW_TAB_BUTTON_MIN_PX,
} from "../../lib/view-tab-overflow";
import {
  type SavedViewActions,
  SavedViewPill,
  SavedViewRowMenu,
  SavedViewLink,
} from "./saved-view-pill";

/** One tab of the strip: a built-in preset, or the member's saved view. */
type ViewTab =
  | { fixed: BuiltInView; id: string; name: string }
  | { id: string; name: string; view: TSavedView };

const isSavedTab = (
  tab: ViewTab
): tab is { id: string; name: string; view: TSavedView } => "view" in tab;

/**
 * The pointer sensor, configured for a pill that is both a link and a drag
 * source.
 *
 * Two overrides of the defaults, and both are needed:
 *
 * - `preventActivation` returns false because the defaults refuse to start a
 *   drag when the pointer went down on an interactive element that is not the
 *   draggable node — and here it always is, since the draggable node is the
 *   pill's wrapper and the pointer lands on the link inside it.
 * - `activationConstraints` restates the delay-then-distance rule by hand. The
 *   defaults skip it whenever the target is the draggable node, which would make
 *   every press on a pill start a drag and swallow the navigation click.
 */
const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [
      new PointerActivationConstraints.Delay({ tolerance: 10, value: 200 }),
      new PointerActivationConstraints.Distance({ value: 5 }),
    ],
    activatorElements(source) {
      return [source.element];
    },
    preventActivation: () => false,
  }),
  KeyboardSensor,
];

/**
 * The board's tabs: the built-in presets and the member's saved views, as one
 * strip that clips what does not fit.
 *
 * Modelled on Linear's view tabs, for the reasons measurement alone cannot
 * solve:
 *
 * 1. Truncation is per tab, not per count. A long name ellipsizes inside its
 *    own pill; only the tabs that genuinely do not fit leave the strip.
 * 2. The built-in presets take part. A narrow toolbar drops `Backlog` into the
 *    popover instead of pushing the member's own views out first.
 * 3. The strip is capped to the width of its *visible* tabs, not to the space
 *    available to it. Clipped tabs keep their layout (so the next measurement
 *    can read their widths) but sit past the cap, which is what stops them
 *    leaving a gap between the last visible pill and the "more" button.
 *
 * On a phone the strip is `display: none`, which reports a zero width, so every
 * tab counts as clipped and the popover carries the whole set.
 */
export function ViewTabStrip({
  activeViewId,
  boardSlug,
  onCreate,
  onDelete,
  onDuplicate,
  onEdit,
  onReorder,
  organizationId,
  rows,
  variant,
}: SavedViewActions & {
  activeViewId: string;
  boardSlug: string | undefined;
  onCreate: () => void;
  onReorder: (orderedIds: string[]) => Promise<void>;
  organizationId: string;
  rows: readonly TSavedView[];
  variant: "board" | "feedback";
}) {
  /**
   * The order the strip shows between a drop and the server confirming it.
   *
   * A reorder cannot ride the collection's own `onUpdate` — that path writes a
   * view's name, description and query, not its position — so the drop is sent
   * as one `ReorderSavedViews` call and the strip keeps the dropped order until
   * the write lands.
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

  const tabs = useMemo<ViewTab[]>(
    () => [
      ...BUILT_IN_VIEW_KEYS.map((fixed) => ({
        fixed,
        id: `fixed:${fixed}`,
        name: BUILT_IN_VIEWS[fixed].name,
      })),
      ...ordered.map((view) => ({ id: view.id, name: view.name, view })),
    ],
    [ordered]
  );

  const fixedCount = BUILT_IN_VIEW_KEYS.length;

  /**
   * Measured geometry.
   *
   * Starts at "everything fits" so the first paint shows the whole strip; the
   * layout effect corrects it before the browser paints.
   */
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const hiddenTabs = useMemo(
    () => tabs.slice(visibleCount),
    [tabs, visibleCount]
  );
  // Whether the popover is rendered changes the space the strip may use, so a
  // measurement has to follow the flip. Reserving a button can only hide more
  // tabs, never all of them, so the two states cannot oscillate.
  const hasOverflow = hiddenTabs.length > 0;

  const measure = useCallback(() => {
    const area = areaRef.current;
    const strip = stripRef.current;

    if (!area || !strip) {
      return;
    }
    // Returning the previous count on an unchanged measurement keeps React from
    // re-rendering on every observed notification.
    const next = measureTabs(area, strip, hasOverflow);
    setVisibleCount((previous) => (previous === next ? previous : next));
  }, [hasOverflow]);

  /**
   * Measure on **every** commit, not only when the tabs or the viewport change.
   *
   * The strip is sized by what it renders, so anything that changes a pill's
   * width, its order, or its presence changes which tabs fit — and a rename, a
   * duplicate, a drag or a refetch all reach the DOM through paths that share no
   * dependency. Measuring after each commit is a handful of reads against a
   * row of buttons; a stale count is a pill the member cannot see.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs after every commit by design; see above
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    const area = areaRef.current;

    if (!area) {
      return undefined;
    }
    // The area, not the strip: the strip's own box is what the measurement
    // changes, and observing it would re-enter this effect's own output.
    const observer = new ResizeObserver(measure);
    observer.observe(area);

    return () => observer.disconnect();
  }, [measure]);

  const commitOrder = async (orderedIds: string[]) => {
    setPendingOrder(orderedIds);

    try {
      await onReorder(orderedIds);
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

  /**
   * The tab the board is showing, when it had to be clipped.
   *
   * The "more" button then carries its name instead of a count: a stripped
   * toolbar that hides where you are is worse than one that hides where you
   * could go, and the count would describe a list the current tab is missing
   * from.
   */
  const activeTab = tabs.find((tab) =>
    isSavedTab(tab)
      ? tab.id === activeViewId
      : BUILT_IN_VIEWS[tab.fixed].id === activeViewId
  );
  const activeTabIsHidden =
    activeTab !== undefined && activeTab.id !== undefined
      ? hiddenTabs.some((tab) => tab.id === activeTab.id)
      : false;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" ref={areaRef}>
      <DragDropProvider onDragEnd={handleDragEnd} sensors={sensors}>
        <div
          className="relative flex min-w-0 items-center gap-2 overflow-hidden"
          ref={stripRef}
        >
          {tabs.map((tab, index) =>
            isSavedTab(tab) ? (
              <SavedViewPill
                boardSlug={boardSlug}
                index={index - fixedCount}
                isClipped={index >= visibleCount}
                key={tab.id}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onEdit={onEdit}
                organizationId={organizationId}
                view={tab.view}
              />
            ) : (
              <TabSlot isClipped={index >= visibleCount} key={tab.id}>
                <FixedViewLink
                  boardSlug={boardSlug}
                  className={toggleVariants({ size: "sm", variant: "outline" })}
                  organizationId={organizationId}
                  tab={tab.fixed}
                  variant={variant}
                >
                  {tab.name}
                </FixedViewLink>
              </TabSlot>
            )
          )}
        </div>
      </DragDropProvider>

      {hasOverflow ? (
        <ViewsPopover
          activeTabIsHidden={activeTabIsHidden}
          boardSlug={boardSlug}
          onCreate={onCreate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onEdit={onEdit}
          organizationId={organizationId}
          tabs={hiddenTabs}
          triggerLabel={
            activeTabIsHidden && activeTab !== undefined
              ? activeTab.name
              : `${hiddenTabs.length} more`
          }
          variant={variant}
        />
      ) : null}

      {/* Icon-only, and hidden on a phone: the popover header carries the same
          action there, because the strip it would sit beside is `display: none`
          at that width. */}
      <Button
        aria-label="New view"
        className="hidden shrink-0 rounded-full sm:inline-flex"
        data-view-tabs-create=""
        onClick={onCreate}
        size="icon-sm"
        type="button"
        // Matches the other icon buttons in this toolbar (filter, display), so
        // the create action reads as a control rather than as another tab.
        variant="outline"
      >
        <HugeiconsIcon icon={LayersPlusIcon} />
      </Button>
    </div>
  );
}

/**
 * The space the strip may use, and the width it should be capped to.
 *
 * Measured from the area rather than from the strip: the strip is capped to its
 * visible tabs, so its own box no longer answers "how much room is there". The
 * buttons beside it are reserved out of the area's width — they are what the
 * strip must leave room for — and so is the gap between them.
 */
const measureTabs = (
  area: HTMLElement,
  strip: HTMLElement,
  hasOverflow: boolean
): number => {
  const areaWidth = area.clientWidth;

  // `display: none` — a phone — reports no client rects. Every tab counts as
  // clipped there, so the popover carries the whole set.
  if (areaWidth === 0 || strip.getClientRects().length === 0) {
    return 0;
  }

  const gap = Number.parseFloat(getComputedStyle(area).columnGap) || 0;
  const createWidth =
    area
      .querySelector<HTMLElement>("[data-view-tabs-create]")
      ?.getBoundingClientRect().width ?? 0;
  // The "more" button is reserved at its *maximum* width rather than at its
  // measured width: its label is the active tab's name when that tab is the one
  // clipped, so measuring the label would make the count depend on its own
  // result — a long name widens the button, which hides one more tab, which
  // keeps the long name on the button. Reserving a constant removes the loop.
  const reserved =
    (createWidth > 0 ? createWidth + gap : 0) +
    (hasOverflow ? OVERFLOW_TAB_BUTTON_MAX_PX + gap : 0);
  return countFittingTabs({
    available: areaWidth - reserved,
    gap,
    widths: Array.from(strip.children).map(
      (child) => child.getBoundingClientRect().width
    ),
  });
};

/**
 * A wrapper that keeps a clipped tab out of sight *and* out of the row's flow,
 * while still being measurable.
 *
 * `absolute w-max` is the part that matters: the tab takes no space, so the strip
 * is exactly as wide as the tabs it shows and the "more" button sits next to the
 * last of them, but the element still reports its full intrinsic width to the
 * next measurement — `display: none` would report zero and the strip could never
 * grow back. `visibility: hidden` keeps it out of hit-testing and the a11y tree.
 *
 * `flex`, not a bare div, because an inline-flex anchor inside a block box sits
 * on a line box whose strut adds leading under it — which made the saved pills a
 * couple of pixels taller than the fixed presets.
 */
function TabSlot({
  children,
  isClipped,
}: {
  children: ReactNode;
  isClipped: boolean;
}) {
  return (
    <div
      className={cn("flex shrink-0", isClipped && "invisible absolute w-max")}
    >
      {children}
    </div>
  );
}

/**
 * A built-in preset's link, on whichever surface the strip is rendered for.
 *
 * The two route shapes are different literal ids, so the branch has to exist
 * somewhere; a map of `{ to, params }` is not assignable to `Link`, whose props
 * are a union discriminated on `to`.
 */
function FixedViewLink({
  boardSlug,
  children,
  className,
  onClick,
  organizationId,
  tab,
  variant,
}: {
  boardSlug: string | undefined;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  organizationId: string;
  tab: BuiltInView;
  variant: "board" | "feedback";
}) {
  const boardParams = { boardSlug: boardSlug ?? "", organizationId };

  if (variant === "feedback") {
    switch (tab) {
      case "all":
        return (
          <Link
            activeOptions={{ exact: true }}
            activeProps={{ "data-pressed": "true" }}
            className={className}
            onClick={onClick}
            params={{ organizationId }}
            to="/$organizationId/feedback"
          >
            {children}
          </Link>
        );
      case "active":
        return (
          <Link
            activeOptions={{ exact: true }}
            activeProps={{ "data-pressed": "true" }}
            className={className}
            onClick={onClick}
            params={{ organizationId }}
            to="/$organizationId/feedback/active"
          >
            {children}
          </Link>
        );
      case "backlog":
        return (
          <Link
            activeOptions={{ exact: true }}
            activeProps={{ "data-pressed": "true" }}
            className={className}
            onClick={onClick}
            params={{ organizationId }}
            to="/$organizationId/feedback/backlog"
          >
            {children}
          </Link>
        );
    }
  }

  switch (tab) {
    case "all":
      return (
        <Link
          activeOptions={{ exact: true }}
          activeProps={{ "data-pressed": "true" }}
          className={className}
          onClick={onClick}
          params={boardParams}
          to="/$organizationId/board/$boardSlug"
        >
          {children}
        </Link>
      );
    case "active":
      return (
        <Link
          activeOptions={{ exact: true }}
          activeProps={{ "data-pressed": "true" }}
          className={className}
          onClick={onClick}
          params={boardParams}
          to="/$organizationId/board/$boardSlug/active"
        >
          {children}
        </Link>
      );
    case "backlog":
      return (
        <Link
          activeOptions={{ exact: true }}
          activeProps={{ "data-pressed": "true" }}
          className={className}
          onClick={onClick}
          params={boardParams}
          to="/$organizationId/board/$boardSlug/backlog"
        >
          {children}
        </Link>
      );
  }
}

/**
 * The overflow button, listing only what the strip had to hide.
 *
 * The label is the count of entries inside, or the active tab's name when the
 * tab you are on is one of the hidden ones — a stripped toolbar that hides where
 * you are is worse than one that hides where you could go. Built-in presets are
 * listed too: on a narrow toolbar, or on a phone (where the strip is hidden and
 * everything overflows), this popover is the only way to reach them.
 */
function ViewsPopover({
  activeTabIsHidden,
  boardSlug,
  onCreate,
  onDelete,
  onDuplicate,
  onEdit,
  organizationId,
  tabs,
  triggerLabel,
  variant,
}: SavedViewActions & {
  activeTabIsHidden: boolean;
  boardSlug: string | undefined;
  onCreate: () => void;
  organizationId: string;
  tabs: readonly ViewTab[];
  triggerLabel: string;
  variant: "board" | "feedback";
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            className="shrink-0 rounded-full"
            // Bounded, not content-sized: the label can be a clipped view's
            // whole name, and `measureTabs` reserves this same maximum rather
            // than the rendered width — see `OVERFLOW_TAB_BUTTON_MAX_PX`.
            style={{
              maxWidth: OVERFLOW_TAB_BUTTON_MAX_PX,
              minWidth: OVERFLOW_TAB_BUTTON_MIN_PX,
            }}
            size="sm"
            variant={activeTabIsHidden ? "secondary" : "outline"}
          />
        }
      >
        <HugeiconsIcon icon={ArrowDown01Icon} />
        <span className="min-w-0 truncate">{triggerLabel}</span>
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-72">
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <span className="text-sm font-medium">
            {tabs.length} more {tabs.length === 1 ? "view" : "views"}
          </span>
          <Button
            aria-label="New view"
            onClick={() => {
              close();
              onCreate();
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={LayersPlusIcon} />
          </Button>
        </div>
        <ul className="flex flex-col gap-0.5">
          {tabs.map((tab) =>
            isSavedTab(tab) ? (
              <li
                className="hover:bg-accent/60 flex items-center gap-1 rounded-md"
                key={tab.id}
              >
                <SavedViewLink
                  boardSlug={boardSlug}
                  className="min-w-0 flex-1 px-2 py-1.5"
                  onClick={close}
                  organizationId={organizationId}
                  viewId={tab.view.id}
                >
                  <span className="block truncate text-sm font-medium">
                    {tab.view.name}
                  </span>
                  {tab.view.description ? (
                    <span className="text-muted-foreground block truncate text-xs">
                      {tab.view.description}
                    </span>
                  ) : null}
                </SavedViewLink>
                <SavedViewRowMenu
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onEdit={onEdit}
                  view={tab.view}
                />
              </li>
            ) : (
              <li className="hover:bg-accent/60 rounded-md" key={tab.id}>
                <FixedViewLink
                  boardSlug={boardSlug}
                  className="block px-2 py-1.5 text-sm font-medium"
                  onClick={close}
                  organizationId={organizationId}
                  tab={tab.fixed}
                  variant={variant}
                >
                  {tab.name}
                </FixedViewLink>
              </li>
            )
          )}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}
