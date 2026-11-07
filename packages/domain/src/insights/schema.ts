import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

/**
 * The windows the dashboard's insights page offers.
 *
 * The window is a literal rather than a free date range on purpose: a range
 * picker is a second feature (it needs validation, a saved preference, and a
 * cache key per range), and these three answer the questions the page is for —
 * "this week", "this month", "this quarter".
 */
export const InsightsRange = S.Literals(["7d", "30d", "90d"]);

export type TInsightsRange = S.Schema.Type<typeof InsightsRange>;

/** Days back from "now" for each window. */
export const INSIGHTS_RANGE_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const satisfies Record<TInsightsRange, number>;

export const InsightsPayload = S.Struct({
  organizationId: WorkspaceId.schema,
  range: InsightsRange,
});

export type TInsightsPayload = S.Schema.Type<typeof InsightsPayload>;

/**
 * One day of activity in the window, in UTC.
 *
 * `date` is `YYYY-MM-DD`, not a timestamp: the bucket is a calendar day, and
 * the server fills every day in the window so a chart does not have to decide
 * whether a missing day is zero or absent. UTC is deliberate — the workspace
 * has no time zone of its own, and a local-day bucket would make two members
 * see different totals for the same board.
 */
export const InsightsPoint = S.Struct({
  date: S.String,
  posts: S.Finite,
  votes: S.Finite,
});

export type TInsightsPoint = S.Schema.Type<typeof InsightsPoint>;

/**
 * The current distribution of active posts across a workspace's statuses.
 *
 * Every status is present, including one nobody is using: a zero is a fact
 * about the board ("nothing is planned"), and omitting the row would make the
 * chart silently shorter. `type` is the fixed vocabulary; `label` is the
 * workspace's name for that status with the type as the fallback.
 */
export const InsightsStatusSlice = S.Struct({
  statusId: S.String,
  type: PostStatusType,
  label: S.String,
  /**
   * The workspace's colour for the status, so the chart matches the board.
   * Null until the workspace customizes it; the page falls back to a neutral
   * swatch rather than inventing a colour per status.
   */
  color: S.NullOr(S.String),
  posts: S.Finite,
});

export type TInsightsStatusSlice = S.Schema.Type<typeof InsightsStatusSlice>;

/**
 * A post nobody has decided anything about: no assignee, no status change,
 * and no comment.
 *
 * This list is current state, not window state. "Oldest untouched" is useful
 * precisely when the oldest item is older than the range; scoping it to the
 * window would hide the post that has been ignored longest.
 */
export const InsightsUntouchedPost = S.Struct({
  id: S.String,
  title: S.String,
  slug: S.String,
  boardName: S.String,
  boardSlug: S.String,
  createdAt: S.DateFromString,
});

export type TInsightsUntouchedPost = S.Schema.Type<
  typeof InsightsUntouchedPost
>;

export const InsightsBoard = S.Struct({
  id: S.String,
  name: S.String,
  slug: S.String,
  posts: S.Finite,
  votes: S.Finite,
});

export type TInsightsBoard = S.Schema.Type<typeof InsightsBoard>;

export const InsightsTag = S.Struct({
  id: S.String,
  name: S.String,
  posts: S.Finite,
});

export type TInsightsTag = S.Schema.Type<typeof InsightsTag>;

/**
 * A voter in the window, named the way the voter list names them: the display
 * name when there is one, null when the account has never set it. The address
 * is deliberately not part of this projection — a leaderboard does not need to
 * publish an end user's email.
 */
export const InsightsVoter = S.Struct({
  name: S.NullOr(S.String),
  votes: S.Finite,
});

export type TInsightsVoter = S.Schema.Type<typeof InsightsVoter>;

/**
 * Followers of the workspace's posts and changelog.
 *
 * These are the dashboard's own subscription tables, so the number agrees with
 * what a post's follower list shows. They are current counts, not window
 * counts: a subscription has no end, and counting "subscriptions created in
 * the last 30 days" would measure acquisition rather than reach.
 */
export const InsightsSubscriptions = S.Struct({
  posts: S.Finite,
  changelog: S.Finite,
});

export type TInsightsSubscriptions = S.Schema.Type<
  typeof InsightsSubscriptions
>;

export const WorkspaceInsights = S.Struct({
  range: InsightsRange,
  since: S.DateFromString,
  until: S.DateFromString,
  summary: S.Struct({
    /** Posts created in the window. */
    posts: S.Finite,
    /** Votes cast in the window. */
    votes: S.Finite,
    /** Posts created in the window that have a status change, and how many. */
    respondedPosts: S.Finite,
    /**
     * Median seconds from a post's creation to its first status change, over
     * the posts created in the window that have one. Null when none do — an
     * average of zero responses is not zero, it is unknown.
     */
    medianFirstResponseSeconds: S.NullOr(S.Finite),
    /** `POST_MERGED` activities in the window. */
    mergedPosts: S.Finite,
    /** `mergedPosts / posts`, or null when no posts were created. */
    mergeRate: S.NullOr(S.Finite),
    /** Posts that are neither archived nor merged, right now. */
    activePosts: S.Finite,
    /** Active posts with no assignee, right now. */
    unassignedPosts: S.Finite,
  }),
  volume: S.Array(InsightsPoint),
  statusMix: S.Array(InsightsStatusSlice),
  untouchedPosts: S.Array(InsightsUntouchedPost),
  topBoards: S.Array(InsightsBoard),
  topTags: S.Array(InsightsTag),
  topVoters: S.Array(InsightsVoter),
  subscriptions: InsightsSubscriptions,
});

export type TWorkspaceInsights = S.Schema.Type<typeof WorkspaceInsights>;
