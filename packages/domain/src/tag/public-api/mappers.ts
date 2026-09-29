import type { TPublicApiTag } from "../../public-api/common";
import type { TPublicApiTagDetail } from "./schema";

/** A tag reference: identity and label, and nothing else. */
export type PublicApiPostTag = {
  readonly id: string;
  readonly name: string;
};

/**
 * What a tag mapper is allowed to read.
 *
 * Declared structurally and narrowly on purpose: a mapper cannot accept the
 * dashboard row (which carries `creatorId`, `creatorMemberId`, and the
 * workspace) and pass it through, and a column added to the `tag` table cannot
 * reach a public response without being added here first. `toTagSource` is the
 * only bridge from the repository row to it.
 */
export type PublicApiTagSource = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** Narrows a repository row to the fields a public response may name. */
export const toTagSource = (row: {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): PublicApiTagSource => ({
  createdAt: row.createdAt,
  id: row.id,
  name: row.name,
  slug: row.slug,
  updatedAt: row.updatedAt,
});

/**
 * A tag reference, as a post payload embeds it.
 *
 * One mapper for both places a reference appears — the `tags` array of a post
 * and the response of setting a post's tags — so the two cannot drift apart.
 */
export const toPublicApiTag = (tag: PublicApiPostTag): TPublicApiTag => ({
  id: tag.id,
  name: tag.name,
});

/**
 * A tag as the tag endpoints return it.
 *
 * No context argument: nothing in a tag is derived from the workspace or the
 * application URL, and taking a context that is never read would invite the
 * next field to be composed from it without thinking about what a machine key
 * is allowed to see.
 */
export const toPublicApiTagDetail = (
  tag: PublicApiTagSource
): TPublicApiTagDetail => ({
  id: tag.id,
  name: tag.name,
  slug: tag.slug,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});
