export type BuiltInView = "all" | "active" | "backlog";

/**
 * The board's three built-in views: their route segment, their name, and the id
 * the board store carries while one is on screen.
 *
 * One definition because three things read it: the route pages build the
 * store's initial view from it, the tab strip labels and matches the active tab
 * with it, and the store's `activeView.id` is what tells the strip which tab is
 * current. Splitting the name from the id is what let a rename in one place
 * silently stop matching in the other.
 */
export const BUILT_IN_VIEWS = {
  all: { id: "all-feedback", name: "All feedbacks" },
  active: { id: "active-feedback", name: "Active" },
  backlog: { id: "backlog-feedback", name: "Backlog" },
} as const satisfies Record<BuiltInView, { id: string; name: string }>;

export const BUILT_IN_VIEW_KEYS = [
  "all",
  "active",
  "backlog",
] as const satisfies readonly BuiltInView[];
