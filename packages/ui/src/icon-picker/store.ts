import { createStore } from "@xstate/store";

import { getIconPickerData } from "./data";
import type {
  IconPickerData,
  IconPickerDataRow,
  IconPickerIcon,
  IconPickerInteraction,
} from "./types";

/**
 * How many extra rows the list renders outside the visible viewport, expressed
 * in rows rather than pixels so it stays correct when the icon size changes.
 */
const VIEWPORT_OVERSCAN = 2;

export type IconPickerStoreConfig = {
  columns: number;
  sticky: boolean;
  value: string | undefined;
  onIconSelect: (icon: IconPickerIcon) => void;
};

export type IconPickerStoreContext = IconPickerStoreConfig & {
  data: IconPickerData;
  search: string;
  interaction: IconPickerInteraction;
  activeColumnIndex: number;
  activeRowIndex: number;
  rowHeight: number | null;
  categoryHeaderHeight: number | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  viewportScrollY: number;
  viewportStartCategoryIndex: number;
  viewportStartRowIndex: number;
  viewportEndRowIndex: number;
};

/**
 * Why the highlight went away. It is carried rather than implied because the
 * reset is sent from three places, and a store inspection should say which.
 */
export type IconPickerResetReason = "blur" | "pointer-leave" | "search-focus";

/**
 * The picker's events. It is an event map rather than a statechart on purpose:
 * the store owns values a statechart would only mirror, and the one lifecycle
 * that is genuinely a machine — `interaction` — is declared as its own union.
 */
type IconPickerStoreEvents = {
  configChanged: {
    columns: number;
    sticky: boolean;
    value: string | undefined;
  };
  searchChanged: { search: string };
  iconActivated: {
    interaction: Exclude<IconPickerInteraction, "none">;
    columnIndex: number;
    rowIndex: number;
  };
  iconActivationReset: { reason: IconPickerResetReason };
  rowHeightMeasured: { height: number };
  categoryHeaderHeightMeasured: { height: number };
  viewportMeasured: { width: number; height: number };
  viewportScrolled: { scrollY: number };
};

type ViewportChanges = Partial<
  Pick<
    IconPickerStoreContext,
    | "categoryHeaderHeight"
    | "data"
    | "rowHeight"
    | "viewportHeight"
    | "viewportWidth"
  >
>;

/**
 * Recomputes the row window the list should render.
 *
 * This is the virtualizer, and it is a port of Frimousse's: a category header
 * is charged once per category above the scroll position, and the visible rows
 * are padded by `VIEWPORT_OVERSCAN` rows on each side. It is a separate
 * function from the store so the arithmetic can be read without the event
 * plumbing around it.
 */
function updateViewportState(
  context: IconPickerStoreContext,
  changes: ViewportChanges
): IconPickerStoreContext {
  const data = changes.data ?? context.data;

  const categoryHeaderHeight =
    changes.categoryHeaderHeight ?? context.categoryHeaderHeight;

  const rowHeight = changes.rowHeight ?? context.rowHeight;
  const viewportHeight = changes.viewportHeight ?? context.viewportHeight;
  const viewportScrollY = context.viewportScrollY;

  if (
    data.rows.length === 0 ||
    !categoryHeaderHeight ||
    !rowHeight ||
    !viewportHeight
  ) {
    return {
      ...context,
      ...changes,
      viewportStartCategoryIndex: 0,
      viewportStartRowIndex: 0,
      viewportEndRowIndex: 0,
    };
  }

  const previousCategoryHeadersHeight = countPreviousHeaders(
    data,
    categoryHeaderHeight,
    rowHeight,
    viewportScrollY
  );

  const totalHeight =
    data.categories.length * categoryHeaderHeight +
    data.rows.length * rowHeight;

  const overscanStart = Math.floor((VIEWPORT_OVERSCAN * rowHeight) / 2);
  const overscanEnd = Math.ceil((VIEWPORT_OVERSCAN * rowHeight) / 2);

  // The scroll position is measured against the list's own height, which does
  // not include the sticky headers already passed — hence the subtraction.
  const viewportStartY = Math.min(
    viewportScrollY - previousCategoryHeadersHeight - overscanStart,
    totalHeight - viewportHeight
  );

  const viewportEndY = viewportStartY + viewportHeight + overscanEnd;

  const viewportStartRowIndex = Math.max(
    0,
    Math.floor(viewportStartY / rowHeight)
  );

  const viewportEndRowIndex = Math.min(
    data.rows.length - 1,
    Math.ceil(viewportEndY / rowHeight)
  );

  const startRow = data.rows[viewportStartRowIndex];

  if (!startRow) {
    return { ...context, ...changes };
  }

  return {
    ...context,
    ...changes,
    viewportStartCategoryIndex: startRow.categoryIndex,
    viewportStartRowIndex,
    viewportEndRowIndex,
  };
}

/**
 * Counts the category headers that have scrolled past, because each one takes
 * its own height out of the list's scroll coordinate space.
 */
function countPreviousHeaders(
  data: IconPickerData,
  categoryHeaderHeight: number,
  rowHeight: number,
  viewportScrollY: number
): number {
  let previousHeadersHeight = 0;
  let categoryIndex = 0;

  for (const category of data.categories) {
    const categoryY =
      categoryIndex++ * categoryHeaderHeight +
      category.startRowIndex * rowHeight;

    if (categoryY < viewportScrollY) {
      previousHeadersHeight += categoryHeaderHeight;
    } else {
      break;
    }
  }

  return previousHeadersHeight;
}

export function createIconPickerStore(config: IconPickerStoreConfig) {
  return createStore<IconPickerStoreContext, IconPickerStoreEvents>({
    context: {
      ...config,
      data: getIconPickerData(config.columns, ""),
      search: "",
      interaction: "none",
      activeColumnIndex: 0,
      activeRowIndex: 0,
      rowHeight: null,
      categoryHeaderHeight: null,
      viewportWidth: null,
      viewportHeight: null,
      viewportScrollY: 0,
      viewportStartCategoryIndex: 0,
      viewportStartRowIndex: 0,
      viewportEndRowIndex: 0,
    },
    on: {
      configChanged: (context, event) => {
        const next: IconPickerStoreContext = {
          ...context,
          columns: event.columns,
          sticky: event.sticky,
          value: event.value,
        };

        // Only a column count changes the row layout; a new `value` or `sticky`
        // must not reset the scroll window.
        return event.columns === context.columns
          ? next
          : withData(next, getIconPickerData(event.columns, context.search));
      },
      searchChanged: (context, event) => {
        const next: IconPickerStoreContext = {
          ...context,
          search: event.search,
          interaction: event.search ? "keyboard" : "none",
        };

        return withData(next, getIconPickerData(context.columns, event.search));
      },
      iconActivated: (context, event) => ({
        ...context,
        interaction: event.interaction,
        activeColumnIndex: event.columnIndex,
        activeRowIndex: event.rowIndex,
      }),
      iconActivationReset: (context) => ({
        ...context,
        interaction: "none",
        activeColumnIndex: 0,
        activeRowIndex: 0,
      }),
      rowHeightMeasured: (context, event) =>
        updateViewportState(context, { rowHeight: event.height }),
      categoryHeaderHeightMeasured: (context, event) =>
        updateViewportState(context, { categoryHeaderHeight: event.height }),
      viewportMeasured: (context, event) =>
        updateViewportState(context, {
          viewportHeight: event.height,
          viewportWidth: event.width,
        }),
      viewportScrolled: (context, event) =>
        updateViewportState({ ...context, viewportScrollY: event.scrollY }, {}),
    },
  });
}

/**
 * Replaces the result set and starts it at its first row: keeping the old
 * active cell would point at an icon the new search no longer contains.
 */
function withData(
  context: IconPickerStoreContext,
  data: IconPickerData
): IconPickerStoreContext {
  return updateViewportState(
    { ...context, activeColumnIndex: 0, activeRowIndex: 0 },
    { data }
  );
}

export type IconPickerStore = ReturnType<typeof createIconPickerStore>;

export type IconPickerStoreSnapshot = ReturnType<
  IconPickerStore["getSnapshot"]
>;

export function selectSearch(state: IconPickerStoreSnapshot): string {
  return state.context.search;
}

export function selectRowsCount(state: IconPickerStoreSnapshot): number {
  return state.context.data.rows.length;
}

export function selectCategoriesCount(state: IconPickerStoreSnapshot): number {
  return state.context.data.categories.length;
}

export function selectCategoriesStartRowIndices(
  state: IconPickerStoreSnapshot
): number[] {
  return state.context.data.categoriesStartRowIndices;
}

/**
 * The icon under the pointer or reached with the arrow keys. `undefined` when
 * nothing is highlighted, which is why the announcer and the preview go quiet
 * instead of announcing the first cell on open.
 */
export function selectActiveIcon(
  context: IconPickerStoreContext
): IconPickerIcon | undefined {
  if (context.interaction === "none") {
    return undefined;
  }

  return context.data.rows[context.activeRowIndex]?.icons[
    context.activeColumnIndex
  ];
}

export function selectIsEmpty(state: IconPickerStoreSnapshot): boolean {
  return state.context.data.count === 0;
}

export function sameIconPickerIcon(
  a: IconPickerIcon | undefined,
  b: IconPickerIcon | undefined
): boolean {
  return a?.name === b?.name;
}

export function sameIconPickerRow(
  a: IconPickerDataRow | undefined,
  b: IconPickerDataRow | undefined
): boolean {
  if (a?.categoryIndex !== b?.categoryIndex) {
    return false;
  }

  if (a?.icons.length !== b?.icons.length) {
    return false;
  }

  return Boolean(
    a?.icons.every((icon, index) => sameIconPickerIcon(icon, b?.icons[index]))
  );
}
