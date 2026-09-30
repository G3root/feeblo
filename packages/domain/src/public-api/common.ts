import * as Schema from "effect/Schema";

/**
 * DTO pieces shared by more than one Public API resource.
 *
 * Kept apart from the per-resource schemas so that a field added to a post
 * cannot widen a comment payload by accident: an author is the same concept on
 * both, and declaring it once is what keeps the two from drifting.
 */

/** Identity of an author, never an internal identifier. */
export const PublicApiAuthor = Schema.Struct({
  type: Schema.Literals(["member", "end_user"]),
  displayName: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});

export type TPublicApiAuthor = Schema.Schema.Type<typeof PublicApiAuthor>;

/**
 * A tag as it appears inside a post.
 *
 * Deliberately only its identity: a post list embeds tags to label the post,
 * and the tag's slug and timestamps would repeat on every post that carries
 * it. The full resource is `PublicApiTagDetail`.
 */
export const PublicApiTag = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export type TPublicApiTag = Schema.Schema.Type<typeof PublicApiTag>;

export const PUBLIC_API_PAGE_DEFAULT_LIMIT = 25;
export const PUBLIC_API_PAGE_MAX_LIMIT = 100;
