export type MyFeedbackView = "created" | "assigned";

/**
 * The two views on the member's own feedback page.
 *
 * Each one is a *scope*, not a board filter: the page pins the live query to
 * `post.creatorMemberId` or `post.assigneeMemberId` for the session's member,
 * which is why these live beside `BUILT_IN_VIEWS` instead of inside
 * `BoardFilters`. A saved view stores filters, and "mine" is not one — the
 * filter menu must not be able to clear it, and a view must not be able to
 * save it for somebody else.
 *
 * The `id` is the board store's `activeView.id`, the same value a built-in
 * preset carries, so the surface needs no second notion of "which page am I".
 */
export const MY_FEEDBACK_VIEWS = {
  created: { id: "created-by-me", name: "Created" },
  assigned: { id: "assigned-to-me", name: "Assigned" },
} as const satisfies Record<MyFeedbackView, { id: string; name: string }>;

/** The member a personal page is scoped to, and how. */
export type MyFeedbackScope = {
  kind: MyFeedbackView;
  memberId: string;
};
