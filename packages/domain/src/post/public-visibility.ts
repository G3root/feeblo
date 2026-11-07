import { schema } from "@feeblo/db";
import { and, type SQL, or, sql } from "drizzle-orm";

import {
  type TPostEngagement,
  type TPostPresence,
  UNSUPERSEDED_POST_PRESENCE_STATES,
  presenceSourceStatesFor,
} from "./machine";

/**
 * The SQL for each presence state, one row per state the machine declares.
 *
 * This is the one place the graph meets the denormalised columns: a presence is
 * stored as two nullable columns, so turning a state back into a predicate
 * needs a mapping. `satisfies Record<TPostPresence, SQL>` makes it total — a
 * state added to the machine is a compile error here until it is described.
 *
 * Callers never pick a row by name. They name the *question* (`presenceSourceStatesFor("merge")`)
 * and the mapping supplies the SQL, so a fragment cannot disagree with the
 * graph the guards are generated from.
 */
const PRESENCE_CONDITION = {
  archived: sql`${schema.postTable.archivedAt} IS NOT NULL AND ${schema.postTable.mergedIntoPostId} IS NULL`,
  listed: sql`${schema.postTable.archivedAt} IS NULL AND ${schema.postTable.mergedIntoPostId} IS NULL`,
  merged: sql`${schema.postTable.mergedIntoPostId} IS NOT NULL`,
} satisfies Record<TPostPresence, SQL>;

/** The SQL for each engagement state. */
const ENGAGEMENT_CONDITION = {
  locked: sql`${schema.postTable.lockedAt} IS NOT NULL`,
  open: sql`${schema.postTable.lockedAt} IS NULL`,
} satisfies Record<TPostEngagement, SQL>;

/** The predicate matching any of `states`, or a predicate that matches nothing. */
const presenceCondition = (states: readonly TPostPresence[]): SQL =>
  or(...states.map((state) => PRESENCE_CONDITION[state])) ?? sql`FALSE`;

/**
 * The predicate for a post that has not been superseded: neither archived nor
 * merged into another.
 *
 * Derived from the merge event's sources rather than written out: the states a
 * post can be merged from are exactly the states that are visible, so if the
 * graph ever gains another merge source the fragment follows it.
 *
 * `publicPostVisibility` composes it, and the dashboard's suggestion search
 * applies it on its own — a candidate must not be a post that every list
 * hides. Dashboard list and detail reads must not use it wholesale: they still
 * see archived and merged posts.
 */
export const activePostVisibility: SQL = presenceCondition(
  presenceSourceStatesFor("merge")
);

/**
 * The predicate for a post people may still comment, vote and react to.
 *
 * Two facts, from the two graphs: the post is not merged (every presence but
 * the merge target), and it is not locked. Archiving is deliberately absent —
 * an archived post leaves the lists, not its own page, and `isUnlocked`
 * returned true for it before this fragment existed.
 */
export const unlockedPostCondition: SQL =
  and(
    presenceCondition(UNSUPERSEDED_POST_PRESENCE_STATES),
    ENGAGEMENT_CONDITION.open
  ) ?? sql`FALSE`;

/**
 * The predicate that makes a post publicly readable.
 *
 * Every public projection — post reads, comments, reactions, votes, tags,
 * changelog links, subscriptions, identity linking, and the OG image —
 * resolves visibility through this one fragment, so a new read cannot apply
 * "public board" while forgetting that an archived or merged post has no
 * public page. Compose it with the query's own scope:
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
  AND ${activePostVisibility}
`;
