import type { TBoardGroupBy } from "@feeblo/domain-contracts/board-query";

const BOARD_GROUPING_LABELS = {
  assignee: "Assignee",
  board: "Board",
  label: "Label",
  none: "No grouping",
  status: "Status",
} satisfies Record<TBoardGroupBy, string>;

/**
 * The order the menu offers, not the order the enum is declared in.
 *
 * `status` is first because it is the default and the kanban reading; `none`
 * is last because leaving the grouping vocabulary is the least common choice.
 */
const BOARD_GROUPING_ORDER = [
  "status",
  "assignee",
  "board",
  "label",
  "none",
] as const satisfies readonly TBoardGroupBy[];

export const BOARD_GROUPING_OPTIONS = BOARD_GROUPING_ORDER.map((value) => ({
  label: BOARD_GROUPING_LABELS[value],
  value,
}));

export const boardGroupingLabel = (field: TBoardGroupBy) =>
  BOARD_GROUPING_LABELS[field];

/**
 * Narrows a control's string value back to a grouping field.
 *
 * The display popover's select and the saved-view editor's radio menu both
 * hand back a `string`; this is the one place that decides which of them is a
 * real `TBoardGroupBy`.
 */
export const isBoardGroupBy = (value: string): value is TBoardGroupBy =>
  BOARD_GROUPING_OPTIONS.some((option) => option.value === value);
