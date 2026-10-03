import * as Schema from "effect/Schema";
import { regexes } from "zod/v4/core";

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

/**
 * The customer an on-behalf write is attributed to.
 *
 * Required wherever a key writes something a person authored — a comment or a
 * vote — because an API key is a machine credential with no user behind it, so
 * the request has to say whose name the record carries. The identifiers are
 * consulted in the same strict priority order the dashboard's on-behalf
 * payload uses (`userId` > `contactId` > `externalId` > `email`), and
 * `name`/`avatarUrl` only enrich the resolved contact.
 *
 * Shared by comments and votes rather than declared per resource: both feed
 * `ResolvePrincipalService`, and a shape one accepted but the other refused
 * would persist a contact the dashboard's own rules would not have created.
 * The email filter is the dashboard's `AuthorEmail` pattern (`post/schema.ts`)
 * restated here, because this module may not import a dashboard schema; the
 * check is the same Zod-core pattern on purpose.
 */
export const PublicApiOnBehalfAuthor = Schema.Struct({
  userId: Schema.optional(Schema.String),
  contactId: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.String),
  email: Schema.optional(
    Schema.String.check(
      Schema.makeFilter((email: string) => regexes.email.test(email), {
        message: "author.email must be a valid email address",
      })
    )
  ),
  name: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
});

export type TPublicApiOnBehalfAuthor = Schema.Schema.Type<
  typeof PublicApiOnBehalfAuthor
>;

export const PUBLIC_API_PAGE_DEFAULT_LIMIT = 25;
export const PUBLIC_API_PAGE_MAX_LIMIT = 100;
