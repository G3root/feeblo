import type { TPublicApiBoard } from "./schema";

/**
 * What a board mapper is allowed to read.
 *
 * Declared structurally and narrowly on purpose: a mapper cannot accept the
 * dashboard row (which carries `creatorId`, `creatorMemberId`, and the
 * workspace) and pass it through, and a column added to the `board` table
 * cannot reach a public response without being added here first. `toBoardSource`
 * is the only bridge from the repository row to it.
 */
export type PublicApiBoardSource = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly visibility: "PUBLIC" | "PRIVATE";
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** Narrows a repository row to the fields a public response may name. */
export const toBoardSource = (row: {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly visibility: "PUBLIC" | "PRIVATE";
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): PublicApiBoardSource => ({
  createdAt: row.createdAt,
  id: row.id,
  name: row.name,
  slug: row.slug,
  updatedAt: row.updatedAt,
  visibility: row.visibility,
});

/**
 * The public board URL, composed the same way a post's is.
 *
 * Both links live under the workspace's portal path, so a caller that has one
 * has learned the shape of the other. The workspace id is part of the URL, not
 * a field of the response: a caller receives exactly one workspace's boards, so
 * an `organizationId` field would be the same string on every response and
 * would invite a filter parameter that would then have to be validated against
 * the key.
 */
export type PublicApiBoardMapperContext = {
  /** Application base URL, without a trailing slash. */
  readonly appUrl: string;
  readonly organizationId: string;
};

export const toPublicApiBoard = (
  board: PublicApiBoardSource,
  context: PublicApiBoardMapperContext
): TPublicApiBoard => ({
  createdAt: board.createdAt,
  id: board.id,
  name: board.name,
  slug: board.slug,
  updatedAt: board.updatedAt,
  url: [
    context.appUrl,
    encodeURIComponent(context.organizationId),
    "board",
    encodeURIComponent(board.slug),
  ].join("/"),
  visibility: board.visibility,
});
