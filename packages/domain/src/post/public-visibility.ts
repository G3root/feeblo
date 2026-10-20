import { schema } from "@feeblo/db";
import { type SQL, sql } from "drizzle-orm";

/**
 * The predicate that makes a post publicly readable.
 *
 * Every public projection — post reads, comments, reactions, votes, tags, and
 * the OG image — resolves visibility through this one fragment, so a new read
 * cannot apply "public board" while forgetting that an archived or merged post
 * has no public page. Compose it with the query's own scope:
 * `and(eq(post.organizationId, organizationId), publicPostVisibility)`.
 *
 * It is a plain `SQL` value rather than an `and(...)` result because `and` is
 * variadic and is typed as possibly `undefined`; callers push or spread this
 * into their own condition lists without a guard.
 *
 * Superseded content stays queryable internally: omit this predicate from
 * dashboard reads, which must still see archived and merged posts.
 */
export const publicPostVisibility: SQL = sql`
  ${schema.boardTable.visibility} = 'PUBLIC'
  AND ${schema.postTable.archivedAt} IS NULL
  AND ${schema.postTable.mergedIntoPostId} IS NULL
`;
