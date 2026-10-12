import { z } from "zod";

/**
 * The review page's addressable state: which rows a view shows and how they
 * are ordered. Keeping it in the URL is what makes a review linkable, and what
 * lets the back button leave a filtered report.
 *
 * Malformed values fall back rather than throw: a hand-edited link should show
 * the default report, not an error boundary.
 */
export const reviewSearchSchema = z.object({
  filter: z
    .enum(["failed", "warned", "pending", "created"])
    .optional()
    .catch(undefined),
  board: z.string().min(1).optional().catch(undefined),
  message: z.string().min(1).optional().catch(undefined),
  page: z.coerce.number().int().min(0).optional().catch(undefined),
  size: z.coerce.number().int().min(25).max(500).optional().catch(undefined),
  sort: z.enum(["row_asc", "row_desc"]).optional().catch(undefined),
});

export type ReviewSearch = z.infer<typeof reviewSearchSchema>;

/** The report window a link that names no window gets. */
export const DEFAULT_REVIEW_PAGE_SIZE = 100;
export const DEFAULT_REVIEW_SORT = "row_asc" as const;
