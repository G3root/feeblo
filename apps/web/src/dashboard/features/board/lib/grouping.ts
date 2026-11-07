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
