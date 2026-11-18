import { isFunction, isString } from "@feeblo/utils/runtime-kind";
import { useSelector } from "@xstate/store-react";
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  Fragment,
  type FocusEvent,
  memo,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent as ReactUIEvent,
} from "react";

import { Button } from "../button";
import { Input } from "../input";
import { Popover, PopoverPopup, PopoverTrigger } from "../popover";
import { cn } from "../utils";
import { loadIconPickerCatalogue, preloadIconPickerCatalogue } from "./data";
import { TABLER_FILLED_SYMBOL_PREFIX } from "./generated/tabler-filled-symbol-prefix";
import { useIconPickerSprite, useIconPickerSpriteStatus } from "./sprite";
import {
  createIconPickerStore,
  type IconPickerStore,
  type IconPickerStoreContext,
  sameIconPickerIcon,
  sameIconPickerRow,
  selectActiveIcon,
  selectCatalogueStatus,
  selectCategoriesCount,
  selectCategoriesStartRowIndices,
  selectIsEmpty,
  selectRowsCount,
  selectSearch,
} from "./store";
import type {
  IconPickerActiveIconProps,
  IconPickerCategory,
  IconPickerContentProps,
  IconPickerData,
  IconPickerDataCategory,
  IconPickerEmptyProps,
  IconPickerEmptyRenderProps,
  IconPickerFieldProps,
  IconPickerIcon,
  IconPickerListCategoryHeaderProps,
  IconPickerListComponents,
  IconPickerListIconProps,
  IconPickerListProps,
  IconPickerListRowProps,
  IconPickerLoadingProps,
  IconPickerRootProps,
  IconPickerSearchProps,
  IconPickerViewportProps,
  WithDataAttributes,
} from "./types";

const ICON_PICKER_ELEMENTS_ERROR =
  "IconPicker parts must be used within <IconPicker.Root>.";

type IconPickerElements = {
  listRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
};

const IconPickerStoreContext = createContext<IconPickerStore | null>(null);

IconPickerStoreContext.displayName = "IconPickerStoreContext";

const IconPickerElementsContext = createContext<IconPickerElements | null>(
  null
);

IconPickerElementsContext.displayName = "IconPickerElementsContext";

const VISUALLY_HIDDEN: CSSProperties = {
  border: 0,
  clip: "rect(0, 0, 0, 0)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
  wordWrap: "normal",
};

function useIconPickerStore(): IconPickerStore {
  const store = use(IconPickerStoreContext);

  if (!store) {
    throw new Error(ICON_PICKER_ELEMENTS_ERROR);
  }

  return store;
}

function useIconPickerElements(): IconPickerElements {
  const elements = use(IconPickerElementsContext);

  if (!elements) {
    throw new Error(ICON_PICKER_ELEMENTS_ERROR);
  }

  return elements;
}

function noop(): void {
  // A picker that is only being browsed has nothing to report.
}

/**
 * Keeps the callback a caller passes in current without putting it in the
 * store's context, so a re-render of the parent does not send an event.
 */
function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result
): (...args: Args) => Result {
  const callbackRef = useRef(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback(
    (...args: Args): Result => callbackRef.current(...args),
    []
  );
}

function isCleanup(value: void | (() => void)): value is () => void {
  return isFunction(value);
}

/**
 * Sets a ref and returns the cleanup a React 19 callback ref handed back.
 *
 * A callback ref may return a cleanup instead of being called with `null` on
 * unmount; the composed wrappers below return it so React can run it, and they
 * clear their internal ref in the same cleanup.
 */
function setRef<T>(
  ref: Ref<T> | undefined,
  value: T | null
): (() => void) | undefined {
  if (!ref) {
    return undefined;
  }

  if ("current" in ref) {
    ref.current = value;

    return undefined;
  }

  const cleanup = ref(value);

  return isCleanup(cleanup) ? cleanup : undefined;
}

/**
 * Composes the picker's internal ref with the caller's `ref`.
 *
 * The returned cleanup clears the internal ref and then either runs the
 * caller's cleanup (a callback ref that returned one) or calls the caller's
 * ref with `null` (an object ref, or a callback that returned nothing). The
 * `null` path only runs for callers that do not use cleanup semantics, since
 * React does not invoke the callback with `null` when it receives a cleanup.
 */
function composeRef<T>(
  internalRef: RefObject<T | null>,
  ref: Ref<T> | undefined,
  value: T | null
): (() => void) | undefined {
  internalRef.current = value;

  if (value === null) {
    setRef(ref, null);

    return undefined;
  }

  const cleanup = setRef(ref, value);

  return () => {
    internalRef.current = null;

    if (cleanup) {
      cleanup();
    } else {
      setRef(ref, null);
    }
  };
}

function isRenderFunction(
  value: ReactNode | ((props: IconPickerEmptyRenderProps) => ReactNode)
): value is (props: IconPickerEmptyRenderProps) => ReactNode {
  return isFunction(value);
}

type IconPickerPosition = {
  columnIndex: number;
  rowIndex: number;
};

/**
 * Left and right step through the current row and wrap onto the neighbouring
 * row at either end. Wrapping is what keeps the highlight reachable when focus
 * is on a cell in the first or last column, which is most of the time.
 */
function moveHorizontally(
  data: IconPickerData,
  position: IconPickerPosition,
  direction: -1 | 1
): IconPickerPosition {
  const row = data.rows[position.rowIndex];

  if (!row) {
    return position;
  }

  const columnIndex = position.columnIndex + direction;

  if (columnIndex >= 0 && columnIndex < row.icons.length) {
    return { columnIndex, rowIndex: position.rowIndex };
  }

  const rowIndex = position.rowIndex + direction;
  const wrappedRow = data.rows[rowIndex];

  if (!wrappedRow) {
    return position;
  }

  return {
    columnIndex: direction === 1 ? 0 : wrappedRow.icons.length - 1,
    rowIndex,
  };
}

/**
 * Up and down keep the column, except on a shorter row, where the last cell is
 * the closest thing to the intended column. That is Frimousse's behaviour.
 */
function moveVertically(
  data: IconPickerData,
  position: IconPickerPosition,
  offset: -1 | 1
): IconPickerPosition {
  const rowIndex = position.rowIndex + offset;
  const row = data.rows[rowIndex];

  if (!row) {
    return position;
  }

  return {
    columnIndex: row.icons[position.columnIndex]
      ? position.columnIndex
      : row.icons.length - 1,
    rowIndex,
  };
}

/**
 * Moves the highlight one cell in the direction pressed.
 */
function moveActiveIcon(
  data: IconPickerData,
  position: IconPickerPosition,
  key: string
): IconPickerPosition {
  switch (key) {
    case "ArrowLeft": {
      return moveHorizontally(data, position, -1);
    }

    case "ArrowRight": {
      return moveHorizontally(data, position, 1);
    }

    case "ArrowUp": {
      return moveVertically(data, position, -1);
    }

    case "ArrowDown": {
      return moveVertically(data, position, 1);
    }

    default: {
      return position;
    }
  }
}

/**
 * Arrow keys move the highlight and Enter selects it, but only while focus is
 * inside the picker. The listener lives on the document because the highlight
 * is a grid cell that never receives focus itself — the search field keeps it,
 * which is what allows typing after arrowing around.
 */
function useIconPickerKeyboard(
  store: IconPickerStore,
  elements: IconPickerElements,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        (!event.key.startsWith("Arrow") && event.key !== "Enter")
      ) {
        return;
      }

      if (event.key === "Enter") {
        const activeIcon = selectActiveIcon(store.get().context);

        if (activeIcon) {
          event.preventDefault();
          store.get().context.onIconSelect(activeIcon);
        }

        return;
      }

      event.preventDefault();

      const { activeColumnIndex, activeRowIndex, data, interaction } =
        store.get().context;

      const position =
        interaction === "none"
          ? { columnIndex: 0, rowIndex: 0 }
          : moveActiveIcon(
              data,
              { columnIndex: activeColumnIndex, rowIndex: activeRowIndex },
              event.key
            );

      store.send({
        type: "iconActivated",
        interaction: "keyboard",
        columnIndex: position.columnIndex,
        rowIndex: position.rowIndex,
      });
      scrollRowIntoView(store, elements, position.rowIndex);
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [elements, enabled, store]);
}

type IconPickerMeasurements = {
  categoryHeaderHeight: number | null;
  rowHeight: number | null;
  viewportHeight: number | null;
  viewportWidth: number | null;
};

/**
 * The measured sizes are published as custom properties on the root, because
 * the sizer, the rows and the category headers all size themselves from them
 * in CSS. A component that renders before the measurement reads the fallbacks
 * until the first `ResizeObserver` callback lands.
 */
function buildRootStyle(
  measurements: IconPickerMeasurements,
  style: CSSProperties | undefined
): CSSProperties {
  // SAFETY: React's CSSProperties has no index signature for custom properties;
  // these four are the measured sizes the list reads.
  return {
    "--icon-picker-category-header-height":
      measurements.categoryHeaderHeight === null
        ? undefined
        : `${measurements.categoryHeaderHeight}px`,
    "--icon-picker-row-height":
      measurements.rowHeight === null
        ? undefined
        : `${measurements.rowHeight}px`,
    "--icon-picker-viewport-height":
      measurements.viewportHeight === null
        ? undefined
        : `${measurements.viewportHeight}px`,
    "--icon-picker-viewport-width":
      measurements.viewportWidth === null
        ? undefined
        : `${measurements.viewportWidth}px`,
    ...style,
  } as CSSProperties;
}

function useIconPickerMeasurements(
  store: IconPickerStore
): IconPickerMeasurements {
  return {
    categoryHeaderHeight: useSelector(
      store,
      (state) => state.context.categoryHeaderHeight
    ),
    rowHeight: useSelector(store, (state) => state.context.rowHeight),
    viewportHeight: useSelector(store, (state) => state.context.viewportHeight),
    viewportWidth: useSelector(store, (state) => state.context.viewportWidth),
  };
}

/**
 * Tracks whether focus is anywhere inside the picker, and clears the highlight
 * left over from the pointer when focus leaves. The keyboard listener is only
 * attached while this is true, so arrowing in another control on the page does
 * not move the picker's highlight.
 */
function useIconPickerFocus(
  store: IconPickerStore,
  rootRef: RefObject<HTMLDivElement | null>,
  onFocusCapture: IconPickerRootProps["onFocusCapture"],
  onBlurCapture: IconPickerRootProps["onBlurCapture"]
) {
  const [isFocusedWithin, setFocusedWithin] = useState(false);

  // `autoFocus` on a server-rendered input focuses it while the browser parses
  // the HTML, before React hydrates and attaches `onFocusCapture`. Without this
  // check the picker behaves as if focus were elsewhere until the user clicks
  // away and back, so the arrow keys do nothing on first open.
  useLayoutEffect(() => {
    const root = rootRef.current;

    if (!root || !root.contains(document.activeElement)) {
      return;
    }

    setFocusedWithin(true);

    if (store.get().context.search === "") {
      store.send({ type: "iconActivationReset", reason: "search-focus" });
    }
  }, [rootRef, store]);

  const handleFocusCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      onFocusCapture?.(event);

      if (event.defaultPrevented) {
        return;
      }

      setFocusedWithin(true);

      if (store.get().context.search === "") {
        store.send({ type: "iconActivationReset", reason: "search-focus" });
      }
    },
    [onFocusCapture, store]
  );

  const handleBlurCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      onBlurCapture?.(event);

      if (
        !event.defaultPrevented &&
        !event.currentTarget.contains(event.relatedTarget)
      ) {
        setFocusedWithin(false);
        store.send({ type: "iconActivationReset", reason: "blur" });
      }
    },
    [onBlurCapture, store]
  );

  return { handleBlurCapture, handleFocusCapture, isFocusedWithin };
}

/**
 * Gathers the parts a picker needs into one compound component.
 *
 * @example
 * ```tsx
 * <IconPicker.Root onIconSelect={({ name }) => setIcon(name)}>
 *   <IconPicker.Search />
 *   <IconPicker.Viewport>
 *     <IconPicker.Loading>Loading…</IconPicker.Loading>
 *     <IconPicker.Empty>No icons found.</IconPicker.Empty>
 *     <IconPicker.List />
 *   </IconPicker.Viewport>
 * </IconPicker.Root>
 * ```
 *
 * `IconPicker.Content` is the same composition with the picker's own styling,
 * for dropping straight into a popover or a dialog.
 */
function IconPickerRoot({
  children,
  className,
  columns = 9,
  onBlurCapture,
  onFocusCapture,
  onIconSelect,
  ref,
  sticky = true,
  style,
  value,
  ...props
}: IconPickerRootProps): ReactElement {
  const stableOnIconSelect = useStableCallback(onIconSelect ?? noop);

  const [store] = useState(() =>
    createIconPickerStore({
      columns,
      onIconSelect: stableOnIconSelect,
      sticky,
      value,
    })
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const elements = useMemo(
    () => ({
      listRef,
      viewportRef,
    }),
    []
  );

  const measurements = useIconPickerMeasurements(store);

  const { handleBlurCapture, handleFocusCapture, isFocusedWithin } =
    useIconPickerFocus(store, rootRef, onFocusCapture, onBlurCapture);

  const setRootElement = useCallback(
    (element: HTMLDivElement | null) => composeRef(rootRef, ref, element),
    [ref]
  );

  useLayoutEffect(() => {
    store.send({ type: "configChanged", columns, sticky, value });
  }, [columns, store, sticky, value]);

  // The catalogue is its own chunk. It starts here, in parallel with the
  // sprite the list's sizer fetches, rather than at module scope: a page that
  // only renders a trigger should never download the search metadata.
  useEffect(() => {
    let cancelled = false;

    void loadIconPickerCatalogue()
      .then((catalogue) => {
        if (!cancelled) {
          store.send({ type: "catalogueSettled", catalogue });
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          console.error("Failed to load the icon picker catalogue.", error);
          store.send({ type: "catalogueSettled", catalogue: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [store]);

  // The default icon and the sizer render `TablerIcon`, which starts the sprite
  // fetch, but a custom `Icon` renderer need not. Starting it here keeps a
  // custom picker from sitting in the loading state forever; the module-level
  // promise makes the duplicate call free.
  useIconPickerSprite();

  useIconPickerKeyboard(store, elements, isFocusedWithin);

  return (
    <IconPickerStoreContext value={store}>
      <IconPickerElementsContext value={elements}>
        <div
          {...props}
          style={buildRootStyle(measurements, style)}
          className={cn("flex flex-col gap-2", className)}
          data-focused={isFocusedWithin ? "" : undefined}
          data-slot="icon-picker"
          onBlurCapture={handleBlurCapture}
          onFocusCapture={handleFocusCapture}
          ref={setRootElement}
        >
          {children}
        </div>
      </IconPickerElementsContext>
    </IconPickerStoreContext>
  );
}

/**
 * The search field. It can be controlled with `value` or left uncontrolled
 * with `defaultValue`, exactly like an `<input>`.
 */
type IconPickerSearchChangeEvent = Parameters<
  NonNullable<IconPickerSearchProps["onChange"]>
>[0];

function IconPickerSearch({
  defaultValue,
  onChange,
  value,
  ...props
}: IconPickerSearchProps): ReactElement {
  const store = useIconPickerStore();
  const isControlled = isString(value);

  useLayoutEffect(() => {
    const initialSearch = isControlled
      ? value
      : isString(defaultValue)
        ? defaultValue
        : "";

    store.send({ type: "searchChanged", search: initialSearch });
  }, []);

  useLayoutEffect(() => {
    if (isString(value)) {
      store.send({ type: "searchChanged", search: value });
    }
  }, [store, value]);

  const handleChange = useCallback(
    (event: IconPickerSearchChangeEvent) => {
      onChange?.(event);

      // A controlled search mirrors `value` through the effect below; reading
      // the DOM here would filter on text the owner refused to accept.
      if (!event.defaultPrevented && !isControlled) {
        store.send({ type: "searchChanged", search: event.target.value });
      }
    },
    [isControlled, onChange, store]
  );

  return (
    <Input
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      data-slot="icon-picker-search"
      enterKeyHint="done"
      placeholder="Search icons…"
      spellCheck={false}
      type="search"
      {...props}
      defaultValue={defaultValue}
      onChange={handleChange}
      value={value}
    />
  );
}

const ActiveIconAnnouncer = memo(function ActiveIconAnnouncer() {
  const activeIcon = useActiveIcon();

  if (!activeIcon) {
    return null;
  }

  return (
    <div aria-live="polite" style={VISUALLY_HIDDEN}>
      {activeIcon.label}
    </div>
  );
});

/**
 * The scrolling container. It is also where the picker is measured: the row
 * height and the header height cannot be assumed, since both come from the
 * consumer's `Icon` and `CategoryHeader` components.
 */
function IconPickerViewport({
  children,
  className,
  onScroll,
  ref,
  style,
  ...props
}: IconPickerViewportProps): ReactElement {
  const store = useIconPickerStore();
  const { viewportRef } = useIconPickerElements();
  const rowsCount = useSelector(store, selectRowsCount);
  const categoriesCount = useSelector(store, selectCategoriesCount);

  const setViewportElement = useCallback(
    (element: HTMLDivElement | null) => composeRef(viewportRef, ref, element),
    [ref, viewportRef]
  );

  const data = useSelector(store, (state) => state.context.data);

  // A new result set starts at the top in the store (see `withData`); this is
  // the DOM half of that reset, and it is keyed on the data object so a
  // `value` or `sticky` change leaves the scroll position alone.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo({ behavior: "instant", top: 0 });
  }, [data, viewportRef]);

  const handleScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      onScroll?.(event);
      store.send({
        type: "viewportScrolled",
        scrollY: event.currentTarget.scrollTop,
      });
    },
    [onScroll, store]
  );

  useLayoutEffect(() => {
    const element = viewportRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry?.borderBoxSize[0]?.inlineSize ?? 0;
      const height = entry?.borderBoxSize[0]?.blockSize ?? 0;
      const state = store.get().context;

      if (state.viewportWidth !== width || state.viewportHeight !== height) {
        store.send({ type: "viewportMeasured", width, height });
      }
    });

    resizeObserver.observe(element);
    store.send({
      type: "viewportMeasured",
      width: element.offsetWidth,
      height: element.clientHeight,
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [store, viewportRef]);

  return (
    <div
      {...props}
      className={cn("relative overflow-y-auto overscroll-contain", className)}
      data-slot="icon-picker-viewport"
      onScroll={handleScroll}
      ref={setViewportElement}
      style={{
        boxSizing: "border-box",
        contain: "layout paint",
        containIntrinsicSize: `var(--icon-picker-viewport-width, auto) calc(${rowsCount} * var(--icon-picker-row-height, 36px) + ${categoriesCount} * var(--icon-picker-category-header-height, 28px))`,
        overflowY: "auto",
        overscrollBehavior: "contain",
        position: "relative",
        scrollbarGutter: "stable",
        willChange: "scroll-position",
        ...style,
      }}
    >
      <ActiveIconAnnouncer />
      {children}
    </div>
  );
}

/**
 * Keeps the highlighted row in view while the arrow keys move it.
 *
 * The arithmetic is Frimousse's: a sticky header is only accounted for when it
 * would cover the row, and the row's own `scroll-margin` is honoured so a
 * consumer can leave room for a ring or a border.
 */
function scrollRowIntoView(
  store: IconPickerStore,
  elements: IconPickerElements,
  rowIndex: number
): void {
  const list = elements.listRef.current;
  const viewport = elements.viewportRef.current;

  const { categoryHeaderHeight, rowHeight, sticky, viewportHeight } =
    store.get().context;

  if (
    !list ||
    !viewport ||
    rowHeight === null ||
    categoryHeaderHeight === null ||
    viewportHeight === null
  ) {
    return;
  }

  if (rowIndex === 0) {
    viewport.scrollTo({ behavior: "instant", top: 0 });
  }

  const row = list.querySelector(`[aria-rowindex="${rowIndex + 1}"]`);
  const renderedRow = row instanceof HTMLElement ? row : null;

  // The row may be one the virtual window has not rendered yet, which happens
  // when the arrow key repeat outruns React's commits. Its position is still
  // known from the data, so navigation keeps scrolling instead of stalling
  // until the highlight leaves the window.
  const rowY = renderedRow
    ? renderedRow.offsetTop
    : estimateRowOffset(store.get().context, rowIndex);

  const computedStyle = renderedRow ? getComputedStyle(renderedRow) : null;

  const scrollMarginTop = computedStyle
    ? Number.parseFloat(computedStyle.scrollMarginTop)
    : 0;

  const scrollMarginBottom = computedStyle
    ? Number.parseFloat(computedStyle.scrollMarginBottom)
    : 0;

  const viewportScrollY = viewport.scrollTop;
  let viewportStartY = viewportScrollY + scrollMarginTop;

  if (sticky && rowY < viewportScrollY + viewportHeight / 2) {
    viewportStartY += categoryHeaderHeight;
  }

  const viewportEndY = viewportStartY + viewportHeight - scrollMarginBottom;

  if (rowY < viewportStartY || rowY + rowHeight > viewportEndY) {
    viewport.scrollTo({
      behavior: "instant",
      top: Math.max(
        rowY < viewportStartY + categoryHeaderHeight
          ? rowY - Math.max(sticky ? categoryHeaderHeight : 0, scrollMarginTop)
          : rowY - viewportHeight + rowHeight + scrollMarginBottom,
        0
      ),
    });
  }
}

/**
 * The content-space Y of a row, computed the same way the sizer computes it:
 * one row height per preceding row, one header height per category that starts
 * at or before this row. It is the fallback for a row the window has not
 * rendered, and it matches `offsetTop` for one it has.
 */
function estimateRowOffset(
  context: IconPickerStoreContext,
  rowIndex: number
): number {
  const rowHeight = context.rowHeight ?? 0;
  const categoryHeaderHeight = context.categoryHeaderHeight ?? 0;

  const headersBefore = context.data.categories.filter(
    (category) => category.startRowIndex <= rowIndex
  ).length;

  return rowIndex * rowHeight + headersBefore * categoryHeaderHeight;
}

function listIconProps(
  icon: IconPickerIcon,
  columnIndex: number,
  isActive: boolean,
  isSelected: boolean
): IconPickerListIconProps {
  return {
    "aria-colindex": columnIndex + 1,
    "aria-label": icon.label,
    "aria-selected": isActive || undefined,
    "data-active": isActive ? "" : undefined,
    "data-selected": isSelected ? "" : undefined,
    "data-slot": "icon-picker-icon",
    icon: { ...icon, isActive, isSelected },
    role: "gridcell",
    tabIndex: -1,
  };
}

function listRowProps(rowIndex: number, sizer = false): IconPickerListRowProps {
  return {
    "aria-rowindex": sizer ? undefined : rowIndex + 1,
    "data-slot": "icon-picker-row",
    role: sizer ? undefined : "row",
    style: {
      contain: sizer ? undefined : "content",
      display: "flex",
      height: sizer ? undefined : "var(--icon-picker-row-height)",
    },
  };
}

function listCategoryProps(
  categoryIndex: number,
  category?: IconPickerDataCategory
): WithDataAttributes<ComponentProps<"div">> {
  return {
    "data-slot": "icon-picker-category",
    style: {
      contain: "content",
      height: category
        ? `calc(var(--icon-picker-category-header-height) + ${category.rowsCount} * var(--icon-picker-row-height))`
        : undefined,
      pointerEvents: "none",
      position: "absolute",
      top: category
        ? `calc(${categoryIndex} * var(--icon-picker-category-header-height) + ${category.startRowIndex} * var(--icon-picker-row-height))`
        : undefined,
      width: "100%",
    },
  };
}

function listCategoryHeaderProps(
  category: IconPickerCategory,
  sizer = false,
  sticky = true
): IconPickerListCategoryHeaderProps {
  return {
    category,
    "data-slot": "icon-picker-category-header",
    style: {
      contain: sizer ? undefined : "layout paint",
      height: sizer ? undefined : "var(--icon-picker-category-header-height)",
      pointerEvents: "auto",
      position: sticky ? "sticky" : undefined,
      top: 0,
    },
  };
}

function listSizerProps(
  rowsCount: number,
  categoriesCount: number,
  viewportStartRowIndex: number,
  previousHeadersCount: number
): WithDataAttributes<ComponentProps<"div">> {
  return {
    "data-slot": "icon-picker-list-sizer",
    style: {
      boxSizing: "border-box",
      height: `calc(${rowsCount} * var(--icon-picker-row-height) + ${categoriesCount} * var(--icon-picker-category-header-height))`,
      paddingTop: `calc(${viewportStartRowIndex} * var(--icon-picker-row-height) + ${previousHeadersCount} * var(--icon-picker-category-header-height))`,
      position: "relative",
    },
  };
}

function listProps(
  columns: number,
  rowsCount: number,
  style: CSSProperties | undefined
): WithDataAttributes<IconPickerListProps> {
  return {
    "aria-colcount": columns,
    "aria-rowcount": rowsCount,
    "data-slot": "icon-picker-list",
    role: "grid",
    style,
  };
}

function preventDefault(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

const IconPickerListIcon = memo(function IconPickerListIcon({
  Icon,
  columnIndex,
  icon,
  rowIndex,
}: {
  Icon: IconPickerListComponents["Icon"];
  columnIndex: number;
  icon: IconPickerIcon;
  rowIndex: number;
}) {
  const store = useIconPickerStore();

  const isActive = useSelector(
    store,
    (state) => selectActiveIcon(state.context)?.name === icon.name
  );

  const isSelected = useSelector(
    store,
    (state) => state.context.value === icon.name
  );

  const handleSelect = useCallback(() => {
    store.get().context.onIconSelect(icon);
  }, [icon, store]);

  const handlePointerEnter = useCallback(() => {
    store.send({
      type: "iconActivated",
      interaction: "pointer",
      columnIndex,
      rowIndex,
    });
  }, [columnIndex, rowIndex, store]);

  const handlePointerLeave = useCallback(() => {
    store.send({ type: "iconActivationReset", reason: "pointer-leave" });
  }, [store]);

  return (
    <Icon
      {...listIconProps(icon, columnIndex, isActive, isSelected)}
      onClick={handleSelect}
      onPointerDown={preventDefault}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    />
  );
});

const IconPickerListRow = memo(function IconPickerListRow({
  Icon,
  Row,
  rowIndex,
}: {
  Icon: IconPickerListComponents["Icon"];
  Row: IconPickerListComponents["Row"];
  rowIndex: number;
}) {
  const store = useIconPickerStore();

  const row = useSelector(
    store,
    (state) => state.context.data.rows[rowIndex],
    sameIconPickerRow
  );

  if (!row) {
    return null;
  }

  return (
    <Row {...listRowProps(rowIndex)}>
      {row.icons.map((icon, columnIndex) => (
        <IconPickerListIcon
          Icon={Icon}
          columnIndex={columnIndex}
          icon={icon}
          key={icon.name}
          rowIndex={rowIndex}
        />
      ))}
    </Row>
  );
});

const IconPickerListCategory = memo(function IconPickerListCategory({
  CategoryHeader,
  categoryIndex,
}: {
  CategoryHeader: IconPickerListComponents["CategoryHeader"];
  categoryIndex: number;
}) {
  const store = useIconPickerStore();

  const category = useSelector(
    store,
    (state) => state.context.data.categories[categoryIndex]
  );

  const sticky = useSelector(store, (state) => state.context.sticky);

  if (!category) {
    return null;
  }

  return (
    <div {...listCategoryProps(categoryIndex, category)}>
      <CategoryHeader {...listCategoryHeaderProps(category, false, sticky)} />
    </div>
  );
});

/**
 * Renders one invisible row and one invisible header so the list can measure
 * them. They have to be the caller's own components: a custom icon with a
 * different size changes every row.
 */
const IconPickerListSizers = memo(function IconPickerListSizers({
  CategoryHeader,
  Icon,
  Row,
}: Pick<IconPickerListComponents, "CategoryHeader" | "Icon" | "Row">) {
  const store = useIconPickerStore();
  const columns = useSelector(store, (state) => state.context.columns);

  const placeholderIcons = useMemo(
    () =>
      Array.from({ length: columns }, (_, index) => ({
        label: "",
        name: `placeholder-${index}`,
      })),
    [columns]
  );

  const category = useMemo<IconPickerCategory>(
    () => ({ label: "Category" }),
    []
  );

  const rowRef = useRef<HTMLDivElement | null>(null);
  const categoryHeaderRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const header = categoryHeaderRef.current;

    if (!row || !header) {
      return;
    }

    const measure = () => {
      const state = store.get().context;

      if (state.rowHeight !== row.clientHeight) {
        store.send({ type: "rowHeightMeasured", height: row.clientHeight });
      }

      if (state.categoryHeaderHeight !== header.clientHeight) {
        store.send({
          type: "categoryHeaderHeightMeasured",
          height: header.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(measure);

    resizeObserver.observe(row);
    resizeObserver.observe(header);
    measure();

    return () => {
      resizeObserver.disconnect();
    };
  }, [store]);

  return (
    <div
      aria-hidden
      style={{
        height: 0,
        visibility: "hidden",
      }}
    >
      <div data-slot="icon-picker-row-sizer" ref={rowRef}>
        <Row {...listRowProps(-1, true)}>
          {placeholderIcons.map((icon, columnIndex) => (
            <Icon
              key={icon.name}
              {...listIconProps(icon, columnIndex, false, false)}
            />
          ))}
        </Row>
      </div>
      <div {...listCategoryProps(-1)}>
        <div
          data-slot="icon-picker-category-header-sizer"
          ref={categoryHeaderRef}
        >
          <CategoryHeader {...listCategoryHeaderProps(category, true)} />
        </div>
      </div>
    </div>
  );
});

function DefaultIconPickerCategoryHeader({
  category,
  className,
  ...props
}: IconPickerListCategoryHeaderProps): ReactElement {
  return (
    <div
      {...props}
      className={cn(
        "text-muted-foreground bg-popover flex h-7 items-center px-1 text-xs font-medium",
        className
      )}
    >
      {category.label}
    </div>
  );
}

function DefaultIconPickerIcon({
  className,
  icon,
  ...props
}: IconPickerListIconProps): ReactElement {
  return (
    <button
      {...props}
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground data-active:bg-accent data-active:text-accent-foreground data-selected:text-primary focus-visible:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2",
        className
      )}
      type="button"
    >
      <TablerIcon className="size-4.5" name={icon.name} />
    </button>
  );
}

function DefaultIconPickerRow({
  className,
  ...props
}: IconPickerListRowProps): ReactElement {
  return (
    <div
      {...props}
      className={cn("flex items-center gap-0.5 px-0.5", className)}
    />
  );
}

const IconPickerListRows = memo(function IconPickerListRows({
  CategoryHeader,
  Icon,
  Row,
  categoriesCount,
  categoriesRowsStartIndices,
  viewportEndRowIndex,
  viewportStartRowIndex,
}: {
  CategoryHeader: IconPickerListComponents["CategoryHeader"];
  Icon: IconPickerListComponents["Icon"];
  Row: IconPickerListComponents["Row"];
  categoriesCount: number;
  categoriesRowsStartIndices: number[];
  viewportEndRowIndex: number;
  viewportStartRowIndex: number;
}) {
  return (
    <>
      {Array.from(
        { length: viewportEndRowIndex - viewportStartRowIndex + 1 },
        (_, index) => {
          const rowIndex = viewportStartRowIndex + index;
          const categoryIndex = categoriesRowsStartIndices.indexOf(rowIndex);

          return (
            <Fragment key={rowIndex}>
              {categoryIndex >= 0 ? (
                <div
                  style={{
                    height: "var(--icon-picker-category-header-height)",
                  }}
                />
              ) : null}
              <IconPickerListRow Icon={Icon} Row={Row} rowIndex={rowIndex} />
            </Fragment>
          );
        }
      )}
      {Array.from({ length: categoriesCount }, (_, index) => (
        <IconPickerListCategory
          CategoryHeader={CategoryHeader}
          categoryIndex={index}
          key={index}
        />
      ))}
    </>
  );
});

/**
 * The icon grid. With `rowsCount` fixed and only the visible rows mounted, the
 * list stays cheap even though the catalogue has over a thousand icons.
 */
function IconPickerList({
  className,
  components,
  ref,
  style,
  ...props
}: IconPickerListProps): ReactElement {
  const store = useIconPickerStore();
  const { listRef } = useIconPickerElements();

  const CategoryHeader =
    components?.CategoryHeader ?? DefaultIconPickerCategoryHeader;

  const Icon = components?.Icon ?? DefaultIconPickerIcon;
  const Row = components?.Row ?? DefaultIconPickerRow;
  const columns = useSelector(store, (state) => state.context.columns);

  const viewportStartRowIndex = useSelector(
    store,
    (state) => state.context.viewportStartRowIndex
  );

  const viewportEndRowIndex = useSelector(
    store,
    (state) => state.context.viewportEndRowIndex
  );

  const rowsCount = useSelector(store, selectRowsCount);

  const categoriesRowsStartIndices = useSelector(
    store,
    selectCategoriesStartRowIndices
  );

  const categoriesCount = categoriesRowsStartIndices.length;

  const previousHeadersCount = useMemo(
    () =>
      categoriesRowsStartIndices.filter(
        (index) => index < viewportStartRowIndex
      ).length,
    [categoriesRowsStartIndices, viewportStartRowIndex]
  );

  const setListElement = useCallback(
    (element: HTMLDivElement | null) => composeRef(listRef, ref, element),
    [listRef, ref]
  );

  return (
    <div
      {...listProps(columns, rowsCount, style)}
      {...props}
      className={cn("relative w-full", className)}
      ref={setListElement}
    >
      <div
        {...listSizerProps(
          rowsCount,
          categoriesCount,
          viewportStartRowIndex,
          previousHeadersCount
        )}
      >
        <IconPickerListSizers
          CategoryHeader={CategoryHeader}
          Icon={Icon}
          Row={Row}
        />
        <IconPickerListRows
          CategoryHeader={CategoryHeader}
          Icon={Icon}
          Row={Row}
          categoriesCount={categoriesCount}
          categoriesRowsStartIndices={categoriesRowsStartIndices}
          viewportEndRowIndex={viewportEndRowIndex}
          viewportStartRowIndex={viewportStartRowIndex}
        />
      </div>
    </div>
  );
}

/**
 * Only renders until the sprite has been fetched and mounted.
 */
function IconPickerLoading({
  children,
  className,
  ...props
}: IconPickerLoadingProps): ReactElement | null {
  const store = useIconPickerStore();
  const catalogueStatus = useSelector(store, selectCatalogueStatus);
  const spriteStatus = useIconPickerSpriteStatus();

  const isCatalogueLoading =
    catalogueStatus === "idle" || catalogueStatus === "loading";

  const isSpriteLoading = spriteStatus === "idle" || spriteStatus === "loading";

  if (!isCatalogueLoading && !isSpriteLoading) {
    return null;
  }

  return (
    <span
      {...props}
      className={cn(
        "text-muted-foreground bg-popover/70 absolute inset-0 z-10 flex items-center justify-center text-sm backdrop-blur-[1px]",
        className
      )}
      data-slot="icon-picker-loading"
    >
      {children}
    </span>
  );
}

/**
 * Only renders when the search matches nothing. The content is rendered in an
 * overlay so it stays centred while the (empty) list still measures itself.
 */
function IconPickerEmpty({
  children,
  className,
  ...props
}: IconPickerEmptyProps): ReactElement | null {
  const store = useIconPickerStore();
  const isEmpty = useSelector(store, selectIsEmpty);
  const search = useSelector(store, selectSearch);

  if (!isEmpty) {
    return null;
  }

  return (
    <span
      {...props}
      className={cn(
        "text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-sm",
        className
      )}
      data-slot="icon-picker-empty"
    >
      {isRenderFunction(children) ? children({ search }) : children}
    </span>
  );
}

function useActiveIcon(): IconPickerIcon | undefined {
  const store = useIconPickerStore();

  const activeIcon = useSelector(
    store,
    (state) => selectActiveIcon(state.context),
    sameIconPickerIcon
  );

  return useDeferredValue(activeIcon);
}

/**
 * Exposes the highlighted icon through a render callback, for a preview next
 * to the list.
 */
function IconPickerActiveIcon({
  children,
}: IconPickerActiveIconProps): ReactNode {
  const activeIcon = useActiveIcon();

  return children({ icon: activeIcon });
}

/**
 * The parts composed into a picker that only needs to be dropped in a
 * popover.
 *
 * @example
 * ```tsx
 * <PopoverPopup>
 *   <IconPicker.Content
 *     value={icon}
 *     onIconSelect={({ name }) => setIcon(name)}
 *   />
 * </PopoverPopup>
 * ```
 *
 * The catalogue is its own chunk. Start it on hover so opening does not wait
 * for it:
 *
 * ```tsx
 * <PopoverTrigger onPointerEnter={IconPicker.preload} render={<Button />}>
 *   <TablerIcon name={icon} />
 * </PopoverTrigger>
 * ```
 */
function IconPickerContent({
  className,
  emptyMessage = "No icons found.",
  viewportClassName,
  ...props
}: IconPickerContentProps): ReactElement {
  return (
    <IconPickerRoot {...props} className={cn("w-80", className)}>
      <IconPickerSearch autoFocus />
      <IconPickerViewport className={cn("h-72 rounded-md", viewportClassName)}>
        <IconPickerLoading>Loading icons…</IconPickerLoading>
        <IconPickerEmpty>{emptyMessage}</IconPickerEmpty>
        <IconPickerList />
      </IconPickerViewport>
    </IconPickerRoot>
  );
}

type TablerIconProps = Omit<ComponentProps<"svg">, "children"> & {
  /**
   * The Tabler name, for example `"arrow-up"`. It is the `name` an
   * `onIconSelect` reports.
   */
  name: string;
};

/**
 * Renders one icon from the sprite.
 *
 * The sprite is fetched by the first icon that renders, so a trigger showing
 * the selected value does not have to open the picker first.
 */
function TablerIcon({
  className,
  name,
  ...props
}: TablerIconProps): ReactElement {
  useIconPickerSprite();

  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0 fill-current", className)}
      data-slot="tabler-icon"
      focusable="false"
      {...props}
    >
      <use href={`#${TABLER_FILLED_SYMBOL_PREFIX}${name}`} />
    </svg>
  );
}

function IconPickerField({
  className,
  disabled,
  fallbackIcon,
  label = "Choose icon",
  onChange,
  value,
}: IconPickerFieldProps): ReactElement {
  const [open, setOpen] = useState(false);

  const selected =
    isString(value) && value.trim().length > 0 ? value : fallbackIcon;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={label}
            className={cn("w-full justify-start", className)}
            disabled={disabled}
            onFocus={() => preloadIconPickerCatalogue()}
            onPointerEnter={() => preloadIconPickerCatalogue()}
            type="button"
            variant="outline"
          />
        }
      >
        <TablerIcon name={selected} />
        <span>{label}</span>
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-auto p-2" sideOffset={6}>
        <IconPickerContent
          onIconSelect={(icon) => {
            onChange(icon.name);
            setOpen(false);
          }}
          value={selected}
        />
        <div className="mt-1 flex justify-end">
          <Button
            onClick={() => {
              onChange(fallbackIcon);
              setOpen(false);
            }}
            size="xs"
            type="button"
            variant="ghost"
          >
            Use default
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

const IconPicker = {
  ActiveIcon: IconPickerActiveIcon,
  Content: IconPickerContent,
  Field: IconPickerField,
  Empty: IconPickerEmpty,
  Icon: TablerIcon,
  List: IconPickerList,
  Loading: IconPickerLoading,
  Root: IconPickerRoot,
  Search: IconPickerSearch,
  Viewport: IconPickerViewport,
  /**
   * Starts the catalogue chunk early. Call it from a trigger's
   * `onPointerEnter`/`onFocus` so opening the picker does not wait for it.
   */
  preload: preloadIconPickerCatalogue,
};

export {
  IconPicker,
  IconPickerActiveIcon,
  IconPickerField,
  IconPickerContent,
  IconPickerEmpty,
  IconPickerList,
  IconPickerLoading,
  IconPickerRoot,
  IconPickerSearch,
  IconPickerViewport,
  TablerIcon,
};

export { preloadIconPickerCatalogue } from "./data";

export { loadIconPickerSprite } from "./sprite";

export type {
  IconPickerActiveIconProps,
  IconPickerCategory,
  IconPickerContentProps,
  IconPickerData,
  IconPickerDataCategory,
  IconPickerDataRow,
  IconPickerEmptyProps,
  IconPickerFieldProps,
  IconPickerIcon,
  IconPickerInteraction,
  IconPickerListCategoryHeaderProps,
  IconPickerListComponents,
  IconPickerListIconProps,
  IconPickerListProps,
  IconPickerListRowProps,
  IconPickerLoadingProps,
  IconPickerRootProps,
  IconPickerSearchProps,
  IconPickerViewportProps,
} from "./types";
