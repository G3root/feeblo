import type { TPublicApiTag } from "../../public-api/common";
import type { PublicApiPostTag, PublicApiTagSource } from "./repository";
import type { TPublicApiTagDetail } from "./schema";

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
