import { currentDb, schema, withTransactionAbortRetry } from "@feeblo/db";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

interface TWindow {
  readonly organizationId: string;
  readonly since: Date;
  readonly until: Date;
}

interface TReadWindow extends TWindow {
  readonly limit: number;
}

interface TSummaryRow {
  readonly posts: number;
  readonly votes: number;
  readonly activePosts: number;
  readonly unassignedPosts: number;
  readonly mergedPosts: number;
}

interface TFirstResponseRow {
  readonly respondedPosts: number;
  readonly medianFirstResponseSeconds: number | null;
}

/**
 * The workspace's read model for the insights page.
 *
 * Every metric is an aggregate over the whole workspace, so none of them
 * belongs in a TanStack DB collection: the dashboard's collections are row
 * lists the browser can filter, and a `GROUP BY` over a workspace's history is
 * neither. `readWindow` is the only read the page makes, and it runs every
 * aggregate in one repeatable-read snapshot so the numbers describe the same
 * moment instead of nine successive ones.
 *
 * Times are compared and bucketed in UTC. The workspace has no time zone, and
 * a bucket cut in the server's local zone would make the same query return
 * different numbers depending on which process answered it.
 */
const makeInsightsRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * The four headline counts and the merge volume in one round trip. Each is
   * an independent scalar subquery, so this stays a single statement rather
   * than five that the snapshot waits for in sequence.
   */
  const summary = ({ organizationId, since, until }: TWindow) =>
    db
      .execute<TSummaryRow>(sql`
        select
          (
            select count(*)::int
            from ${schema.postTable} p
            where p.organization_id = ${organizationId}
              and p.created_at >= ${since}
              and p.created_at <= ${until}
          ) as "posts",
          (
            select count(*)::int
            from ${schema.upvoteTable} u
            where u.organization_id = ${organizationId}
              and u.created_at >= ${since}
              and u.created_at <= ${until}
          ) as "votes",
          (
            select count(*)::int
            from ${schema.postTable} p
            where p.organization_id = ${organizationId}
              and p.archived_at is null
              and p.merged_into_post_id is null
          ) as "activePosts",
          (
            select count(*)::int
            from ${schema.postTable} p
            where p.organization_id = ${organizationId}
              and p.archived_at is null
              and p.merged_into_post_id is null
              and p.assignee_member_id is null
          ) as "unassignedPosts",
          (
            select count(*)::int
            from ${schema.postActivityTable} a
            where a.organization_id = ${organizationId}
              and a.kind = 'POST_MERGED'
              and a.created_at >= ${since}
              and a.created_at <= ${until}
          ) as "mergedPosts"
      `)
      .pipe(
        Effect.map(
          (result) =>
            result.rows[0] ?? {
              posts: 0,
              votes: 0,
              activePosts: 0,
              unassignedPosts: 0,
              mergedPosts: 0,
            }
        )
      );

  /**
   * Median time to the first status change, over posts created in the window
   * that have one.
   *
   * A post with no response is not a zero-second response; it is missing
   * data, and folding it in as zero (or as the window length) would report a
   * healthy product for a board nobody answers. `respondedPosts` is returned
   * beside the median so the page can say what it is the median of.
   *
   * Both bounds apply to the activity as well: a status change after `until`
   * did not exist yet at the moment the window ends, even if its row committed
   * before this snapshot.
   */
  const firstResponse = ({ organizationId, since, until }: TWindow) =>
    db
      .execute<TFirstResponseRow>(sql`
        select
          count(*)::int as "respondedPosts",
          percentile_cont(0.5) within group (
            order by extract(
              epoch from (first_change.changed_at - p.created_at)
            )::double precision
          ) as "medianFirstResponseSeconds"
        from ${schema.postTable} p
        join (
          select a.post_id, min(a.created_at) as changed_at
          from ${schema.postActivityTable} a
          where a.organization_id = ${organizationId}
            and a.kind = 'STATUS_CHANGED'
            and a.created_at <= ${until}
          group by a.post_id
        ) first_change on first_change.post_id = p.id
        where p.organization_id = ${organizationId}
          and p.created_at >= ${since}
          and p.created_at <= ${until}
      `)
      .pipe(
        Effect.map(
          (result) =>
            result.rows[0] ?? {
              respondedPosts: 0,
              medianFirstResponseSeconds: null,
            }
        )
      );

  /**
   * Posts and votes per UTC day, with a row for every day in the window.
   *
   * `generate_series` produces the calendar, so a day with no activity is a
   * zero row instead of a gap the chart would have to invent. The handler
   * passes the start of the first day, so a 7-day range returns seven
   * points: today is partial and still a day.
   */
  const volume = ({ organizationId, since, until }: TWindow) =>
    db.execute<{ date: string; posts: number; votes: number }>(sql`
      with days as (
        select generate_series(
          date_trunc('day', ${since}::timestamptz at time zone 'utc'),
          date_trunc('day', ${until}::timestamptz at time zone 'utc'),
          interval '1 day'
        ) as day
      ),
      post_days as (
        select
          to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD') as day,
          count(*)::int as total
        from ${schema.postTable} p
        where p.organization_id = ${organizationId}
          and p.created_at >= ${since}
          and p.created_at <= ${until}
        group by 1
      ),
      vote_days as (
        select
          to_char(u.created_at at time zone 'utc', 'YYYY-MM-DD') as day,
          count(*)::int as total
        from ${schema.upvoteTable} u
        where u.organization_id = ${organizationId}
          and u.created_at >= ${since}
          and u.created_at <= ${until}
        group by 1
      )
      select
        to_char(d.day, 'YYYY-MM-DD') as "date",
        coalesce(post_days.total, 0)::int as "posts",
        coalesce(vote_days.total, 0)::int as "votes"
      from days d
      left join post_days on post_days.day = to_char(d.day, 'YYYY-MM-DD')
      left join vote_days on vote_days.day = to_char(d.day, 'YYYY-MM-DD')
      order by d.day asc
    `);

  /**
   * Active posts per status, starting from the workspace's statuses rather
   * than from its posts.
   *
   * The direction matters: an inner join from posts would drop a status with
   * nothing in it, and the status list is exactly the set of columns the
   * board wants to show. The label falls back to the type the same way the
   * rest of the dashboard names a status.
   */
  const statusMix = ({ organizationId }: { readonly organizationId: string }) =>
    db
      .select({
        statusId: schema.postStatusTable.id,
        type: schema.postStatusTable.type,
        label: sql<string>`coalesce(nullif(${schema.postStatusTable.label}, ''), ${schema.postStatusTable.type})`,
        color: schema.postStatusTable.color,
        posts: count(schema.postTable.id),
      })
      .from(schema.postStatusTable)
      .leftJoin(
        schema.postTable,
        and(
          eq(schema.postTable.statusId, schema.postStatusTable.id),
          eq(
            schema.postTable.organizationId,
            schema.postStatusTable.organizationId
          ),
          isNull(schema.postTable.archivedAt),
          isNull(schema.postTable.mergedIntoPostId)
        )
      )
      .where(eq(schema.postStatusTable.organizationId, organizationId))
      .groupBy(
        schema.postStatusTable.id,
        schema.postStatusTable.type,
        schema.postStatusTable.label,
        schema.postStatusTable.color,
        schema.postStatusTable.orderIndex
      )
      .orderBy(schema.postStatusTable.orderIndex);

  /**
   * The posts nobody has touched, oldest first.
   *
   * "Untouched" is deliberately three facts, not an `updated_at` comparison:
   * an edit to the body is not a triage decision, a status change is, an
   * assignment is, and a comment is somebody paying attention. The two
   * `not exists` clauses use the activity and comment indexes rather than a
   * join, so a workspace with a million activities still costs one lookup per
   * candidate post until the limit is reached.
   */
  const untouchedPosts = ({
    organizationId,
    limit,
  }: {
    readonly organizationId: string;
    readonly limit: number;
  }) =>
    db.execute<{
      id: string;
      title: string;
      slug: string;
      boardName: string;
      boardSlug: string;
      createdAt: Date;
    }>(sql`
      select
        p.id,
        p.title,
        p.slug,
        b.name as "boardName",
        b.slug as "boardSlug",
        p.created_at as "createdAt"
      from ${schema.postTable} p
      join ${schema.boardTable} b on b.id = p.board_id
      where p.organization_id = ${organizationId}
        and p.archived_at is null
        and p.merged_into_post_id is null
        and p.assignee_member_id is null
        and not exists (
          select 1
          from ${schema.postActivityTable} a
          where a.post_id = p.id and a.kind = 'STATUS_CHANGED'
        )
        and not exists (
          select 1
          from ${schema.commentTable} c
          where c.post_id = p.id
        )
      order by p.created_at asc, p.id asc
      limit ${limit}
    `);

  /**
   * Boards ranked by the activity they drew in the window.
   *
   * Posts and votes are aggregated separately before the join: joining the
   * two detail tables directly would multiply every post by every vote on
   * it and report a number that is the product of the two counts.
   */
  const topBoards = ({ organizationId, since, until }: TWindow) =>
    db.execute<{
      id: string;
      name: string;
      slug: string;
      posts: number;
      votes: number;
    }>(sql`
      select
        b.id,
        b.name,
        b.slug,
        coalesce(post_totals.total, 0)::int as "posts",
        coalesce(vote_totals.total, 0)::int as "votes"
      from ${schema.boardTable} b
      left join (
        select p.board_id, count(*)::int as total
        from ${schema.postTable} p
        where p.organization_id = ${organizationId}
          and p.created_at >= ${since}
          and p.created_at <= ${until}
        group by p.board_id
      ) post_totals on post_totals.board_id = b.id
      left join (
        select p.board_id, count(*)::int as total
        from ${schema.upvoteTable} u
        join ${schema.postTable} p on p.id = u.post_id
        where u.organization_id = ${organizationId}
          and u.created_at >= ${since}
          and u.created_at <= ${until}
        group by p.board_id
      ) vote_totals on vote_totals.board_id = b.id
      where b.organization_id = ${organizationId}
      order by
        (coalesce(post_totals.total, 0) + coalesce(vote_totals.total, 0)) desc,
        b.name asc
      limit 5
    `);

  /**
   * Tags on the posts created in the window, by how many posts carry them.
   *
   * Counting posts rather than tag links makes the number comparable to the
   * board table: "five posts about billing" is the same kind of fact as "five
   * posts on the billing board".
   */
  const topTags = ({ organizationId, since, until }: TWindow) =>
    db.execute<{ id: string; name: string; posts: number }>(sql`
      select
        t.id,
        t.name,
        count(pt.post_id)::int as "posts"
      from ${schema.tagTable} t
      join ${schema.postTagTable} pt on pt.tag_id = t.id
      join ${schema.postTable} p on p.id = pt.post_id
      where t.organization_id = ${organizationId}
        and p.organization_id = ${organizationId}
        and p.created_at >= ${since}
        and p.created_at <= ${until}
      group by t.id, t.name
      order by "posts" desc, t.name asc
      limit 5
    `);

  /**
   * Voters by how many votes they cast in the window.
   *
   * The name falls back to null rather than to the address, matching the
   * post's voter panel: a leaderboard says "Anonymous", it does not publish
   * an end user's email to the workspace.
   */
  const topVoters = ({ organizationId, since, until }: TWindow) =>
    db.execute<{ name: string | null; votes: number }>(sql`
      select
        nullif(u.name, '') as "name",
        count(*)::int as "votes"
      from ${schema.upvoteTable} v
      join ${schema.userTable} u on u.id = v.user_id
      where v.organization_id = ${organizationId}
        and v.created_at >= ${since}
        and v.created_at <= ${until}
      group by u.id, u.name
      order by "votes" desc, u.name asc nulls last
      limit 5
    `);

  /**
   * Current follower counts for the two things a workspace publishes.
   *
   * Two scalar subqueries, not a join: the tables have nothing in common to
   * join on, and one row with two numbers is the shape the page wants.
   */
  const subscriptions = ({
    organizationId,
  }: {
    readonly organizationId: string;
  }) =>
    db
      .execute<{ posts: number; changelog: number }>(sql`
        select
          (
            select count(*)::int
            from ${schema.postSubscriptionTable} s
            where s.organization_id = ${organizationId}
          ) as "posts",
          (
            select count(*)::int
            from ${schema.changelogSubscriptionTable} s
            where s.organization_id = ${organizationId}
          ) as "changelog"
      `)
      .pipe(
        Effect.map((result) => result.rows[0] ?? { posts: 0, changelog: 0 })
      );

  return {
    /**
     * Every metric the page renders, read from one database snapshot.
     *
     * The nine reads used to run concurrently, which meant each statement saw
     * its own `READ COMMITTED` snapshot: a post created mid-request could be
     * counted in `volume` but not in `summary`, or in a leaderboard but not in
     * the headline. `REPEATABLE READ` makes every aggregate describe the same
     * committed state, which is the only way the page's numbers can be
     * compared to each other.
     *
     * Sequential on purpose: the reads share one connection inside the
     * snapshot, so unbounded concurrency would only queue them on that
     * connection. `withTransactionAbortRetry` re-runs the whole snapshot if
     * Postgres aborts it (`40001`, `40P01`, `55P03`), which is the documented
     * reason to call `db.transaction` directly instead of the `transaction`
     * helper.
     */
    readWindow: ({ organizationId, since, until, limit }: TReadWindow) =>
      db
        .transaction(
          () =>
            Effect.all({
              summary: summary({ organizationId, since, until }),
              firstResponse: firstResponse({ organizationId, since, until }),
              volume: volume({ organizationId, since, until }),
              statusMix: statusMix({ organizationId }),
              untouchedPosts: untouchedPosts({ organizationId, limit }),
              topBoards: topBoards({ organizationId, since, until }),
              topTags: topTags({ organizationId, since, until }),
              topVoters: topVoters({ organizationId, since, until }),
              subscriptions: subscriptions({ organizationId }),
            }),
          { isolationLevel: "repeatable read" }
        )
        .pipe(withTransactionAbortRetry),
  };
});

export class InsightsRepository extends Context.Service<InsightsRepository>()(
  "InsightsRepository",
  {
    make: makeInsightsRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
