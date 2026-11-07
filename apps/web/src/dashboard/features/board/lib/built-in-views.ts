import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";

export type BuiltInView = "all" | "active" | "backlog";

/**
 * The board's three built-in views: their route segment, their name, the id the
 * board store carries while one is on screen, and the status types they show.
 *
 * One definition because three things read it: the route pages build the
 * store's initial filters from `statusTypes`, the tab strip labels and matches
 * the active tab with the id, and the board's lane order uses the same
 * vocabulary. Splitting the name from the id is what let a rename in one place
 * silently stop matching in the other.
 *
 * `statusTypes` is the view, not a preset beside it: "Active" and "Backlog"
 * were once a separate `postStatus` dimension that overlapped the status
 * checklist, so a view could store "active" *and* a checklist of backlog
 * statuses and match nothing. Here the two are the same filter, and the
 * checklist is what the filter menu edits.
 */
export const BUILT_IN_VIEWS = {
  all: { id: "all-feedback", name: "All feedbacks", statusTypes: [] },
  active: {
    id: "active-feedback",
    name: "Active",
    statusTypes: ["PLANNED", "IN_PROGRESS"],
  },
  backlog: {
    id: "backlog-feedback",
    name: "Backlog",
    statusTypes: ["PENDING", "REVIEW"],
  },
} as const satisfies Record<
  BuiltInView,
  { id: string; name: string; statusTypes: readonly TPostStatusType[] }
>;

export const BUILT_IN_VIEW_KEYS = [
  "all",
  "active",
  "backlog",
] as const satisfies readonly BuiltInView[];
