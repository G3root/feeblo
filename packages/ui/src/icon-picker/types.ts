import type { ComponentProps, ComponentType, ReactNode } from "react";

import type { InputProps } from "../input";

/**
 * The `data-*` attributes the parts set for styling and for the CSS the
 * virtualized list relies on. Declaring them keeps a caller from having to
 * widen the prop type with an index signature to pass one through.
 */
export type WithDataAttributes<T> = T & {
  [attribute: `data-${string}`]: string | number | undefined;
};

/**
 * One row of the generated metadata. `category` is an index into
 * `TABLER_FILLED_CATEGORIES`, not the category's name: the name is stored once
 * in the category list and the picker joins it back.
 */
export type TablerFilledIconRecord = {
  readonly name: string;
  readonly label: string;
  readonly category: number;
  readonly tags: readonly string[];
};

/**
 * An icon as the picker passes it to `onIconSelect` and to a custom `Icon`
 * component. It is deliberately not the generated record: a consumer needs a
 * name to store and a label to announce, and nothing else.
 */
export type IconPickerIcon = {
  name: string;
  label: string;
};

export type IconPickerCategory = {
  label: string;
};

export type IconPickerDataRow = {
  categoryIndex: number;
  icons: IconPickerIcon[];
};

export type IconPickerDataCategory = {
  label: string;
  rowsCount: number;
  startRowIndex: number;
};

export type IconPickerData = {
  count: number;
  categories: IconPickerDataCategory[];
  categoriesStartRowIndices: number[];
  rows: IconPickerDataRow[];
};

/**
 * `none` means nothing is highlighted: the picker is not focused, or focus is
 * in the search field before the first arrow key. It is a state rather than a
 * boolean on purpose — a pointer and a keyboard highlight behave differently,
 * and only the keyboard one scrolls the list.
 */
export type IconPickerInteraction = "none" | "keyboard" | "pointer";

export type IconPickerSpriteStatus = "idle" | "loading" | "ready" | "error";

export type IconPickerListIconProps = WithDataAttributes<
  Omit<ComponentProps<"button">, "children">
> & {
  icon: IconPickerIcon & {
    isActive: boolean;
    isSelected: boolean;
  };
};

export type IconPickerListCategoryHeaderProps = WithDataAttributes<
  Omit<ComponentProps<"div">, "children">
> & {
  category: IconPickerCategory;
};

export type IconPickerListRowProps = WithDataAttributes<ComponentProps<"div">>;

export type IconPickerListComponents = {
  /**
   * Renders a sticky category header. All headers must have the same height.
   */
  CategoryHeader: ComponentType<IconPickerListCategoryHeaderProps>;

  /**
   * Renders one row of icons. Rows do not need a fixed height: the list
   * measures the first one.
   */
  Row: ComponentType<IconPickerListRowProps>;

  /**
   * Renders one icon button. Every icon should have the same size.
   */
  Icon: ComponentType<IconPickerListIconProps>;
};

export interface IconPickerListProps extends ComponentProps<"div"> {
  components?: Partial<IconPickerListComponents>;
}

export interface IconPickerRootProps extends ComponentProps<"div"> {
  /**
   * The number of icons in a row. Changing it re-flows the list.
   *
   * @default 9
   */
  columns?: number;

  /**
   * Whether the category headers stay pinned to the top of the viewport.
   *
   * @default true
   */
  sticky?: boolean;

  /**
   * The selected icon's name, marked with `data-selected`. The picker does not
   * own the selection: it reports it through `onIconSelect` and renders the
   * value it is given.
   */
  value?: string;

  /**
   * Called with the icon a click or Enter selected.
   */
  onIconSelect?: (icon: IconPickerIcon) => void;
}

export type IconPickerSearchProps = WithDataAttributes<
  Omit<InputProps, "type">
>;

export type IconPickerViewportProps = ComponentProps<"div">;

export type IconPickerLoadingProps = ComponentProps<"span">;

export type IconPickerEmptyRenderProps = {
  search: string;
};

export interface IconPickerEmptyProps extends Omit<
  ComponentProps<"span">,
  "children"
> {
  /**
   * The content to render when the search matches nothing, or a render callback
   * that receives the current search value.
   */
  children?: ReactNode | ((props: IconPickerEmptyRenderProps) => ReactNode);
}

export type IconPickerActiveIconRenderProps = {
  /**
   * The icon under the pointer or reached with the arrow keys.
   */
  icon: IconPickerIcon | undefined;
};

export type IconPickerActiveIconProps = {
  children: (props: IconPickerActiveIconRenderProps) => ReactNode;
};

/**
 * The picker behind a trigger button, in a popover.
 *
 * A convenience composition rather than a fifth part: the picker itself does
 * not own a popover, and the settings dialogs that select an entity icon would
 * otherwise each repeat the same trigger, popup and preload wiring. `onChange`
 * reports the Tabler name the caller stores, or null when "Use default" was
 * chosen so the caller can persist "no override" rather than a catalogue name.
 */
export type IconPickerFieldProps = {
  className?: string;
  disabled?: boolean;
  /** The icon a null value renders and "Use default" restores. */
  fallbackIcon: string;
  /** The trigger's visible text and accessible name. */
  label?: string;
  onChange: (name: string | null) => void;
  value: string | null | undefined;
};

export type IconPickerContentProps = Omit<IconPickerRootProps, "children"> & {
  /**
   * The message shown when a search has no matches.
   *
   * @default "No icons found."
   */
  emptyMessage?: ReactNode;

  /**
   * Extra classes for the scrolling viewport, which is where the picker's
   * height lives.
   */
  viewportClassName?: string;
};
