import type { TPostStatusType } from "./post-status-type";

/**
 * Default oklch() colors for the built-in post statuses.
 *
 * Seeded into `post_status.color` when a workspace is created. Living in
 * domain-contracts so server seeding and any client-side status rendering
 * share a single source of truth.
 */
export const DEFAULT_POST_STATUS_COLORS = {
  PENDING: "oklch(0.556 0 0)",
  REVIEW: "oklch(0.666 0.179 58.318)",
  PLANNED: "oklch(0.585 0.233 277.117)",
  IN_PROGRESS: "oklch(0.795 0.184 86.047)",
  COMPLETED: "oklch(0.696 0.17 162.48)",
  CLOSED: "oklch(0.637 0.208 25.331)",
} satisfies Record<TPostStatusType, string>;
