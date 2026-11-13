import { currentDb, schema, withTransactionAbortRetry } from "@feeblo/db";
import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { publicPostVisibility } from "../post/public-visibility";
import type { TPostTraffic, TPostViewDimensionCount } from "./schema";
import type { TPostViewClient } from "./user-agent";

/** How many rows a breakdown shows before it stops being a breakdown. */
const BREAKDOWN_LIMIT = 5;

export interface TRecordPostViewInput extends TPostViewClient {
  readonly country: string;
  readonly id: string;
  readonly postId: string;
}

export interface TPostTrafficRead {
  readonly organizationId: string;
  readonly postId: string;
  readonly since: Date;
}

const makePostTrafficRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * One breakdown over the event window.
   *
   * The column is passed as a value rather than a name so the four calls are
   * the same query shape with a different column, and no caller can turn a
   * request parameter into SQL.
   */
  const breakdown = (
    column: typeof schema.postViewEventTable.country,
    { postId, since }: Pick<TPostTrafficRead, "postId" | "since">
  ) =>
    db
      .select({
        value: column,
        views: sql<number>`count(*)::int`,
      })
      .from(schema.postViewEventTable)
      .where(
        and(
          eq(schema.postViewEventTable.postId, postId),
          gte(schema.postViewEventTable.occurredAt, since),
          ne(column, "")
        )
      )
      .groupBy(column)
      .orderBy(desc(sql`count(*)`), column)
      .limit(BREAKDOWN_LIMIT);

  return {
    /**
     * Record one page view, if the post is one a visitor could actually see.
     *
     * The visibility check is here, not in the transport: the endpoint is
     * public, and a caller can name any post id. Counting a draft, a private
     * board's post, or a merged tombstone would put a number on a page nobody
     * can open.
     *
     * The event insert is idempotent on the client's id and gates the counter
     * increment. That is what makes the write safe under the transaction
     * retry: if Postgres aborts and the helper re-runs the body, the previous
     * attempt's insert rolled back with it, so the row lands once and the
     * counter moves once.
     */
    recordView: (input: TRecordPostViewInput) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const visible = yield* db
                .select({ id: schema.postTable.id })
                .from(schema.postTable)
                .innerJoin(
                  schema.boardTable,
                  eq(schema.boardTable.id, schema.postTable.boardId)
                )
                // The post lifecycle's own predicate: an archived or merged
                // post has no public page, and a private board's post is not
                // reachable. Reusing the derived fragment is what keeps this
                // ingest from becoming a second copy of the machine.
                .where(
                  and(
                    eq(schema.postTable.id, input.postId),
                    publicPostVisibility
                  )
                )
                .limit(1);

              if (visible.length === 0) {
                return false;
              }

              const inserted = yield* db
                .insert(schema.postViewEventTable)
                .values({
                  browser: input.browser,
                  country: input.country,
                  device: input.device,
                  id: input.id,
                  occurredAt: now,
                  os: input.os,
                  postId: input.postId,
                })
                .onConflictDoNothing()
                .returning({ id: schema.postViewEventTable.id });

              if (inserted.length === 0) {
                // A retried beacon: the view is already counted.
                return true;
              }

              yield* db
                .insert(schema.postViewTotalTable)
                .values({ postId: input.postId, updatedAt: now, views: 1 })
                .onConflictDoUpdate({
                  target: schema.postViewTotalTable.postId,
                  set: {
                    updatedAt: now,
                    views: sql`${schema.postViewTotalTable.views} + 1`,
                  },
                });

              return true;
            })
          )
          .pipe(withTransactionAbortRetry);
      }),

    /**
     * The counter alone, for the post detail's sidebar.
     *
     * One statement: the post scopes the read to the workspace and the left
     * join yields zero when the post has never been viewed.
     */
    getPostViewCount: ({
      organizationId,
      postId,
    }: Pick<TPostTrafficRead, "organizationId" | "postId">) =>
      Effect.gen(function* () {
        const posts = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1);

        if (posts.length === 0) {
          return Option.none<number>();
        }

        const totals = yield* db
          .select({ views: schema.postViewTotalTable.views })
          .from(schema.postViewTotalTable)
          .where(eq(schema.postViewTotalTable.postId, postId))
          .limit(1);

        return Option.some(totals[0]?.views ?? 0);
      }),

    /**
     * The all-time count and the last-30-days breakdown for one post.
     *
     * The post is resolved first and scoped by organization, so the read cannot
     * answer for another workspace's post. An archived or merged post still
     * has a dashboard page, so it still has a count; only ingest refuses it.
     */
    getPostTraffic: ({ organizationId, postId, since }: TPostTrafficRead) =>
      Effect.gen(function* () {
        const posts = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, postId),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .limit(1);

        if (posts.length === 0) {
          return Option.none<TPostTraffic>();
        }

        const totals = yield* db
          .select({ views: schema.postViewTotalTable.views })
          .from(schema.postViewTotalTable)
          .where(eq(schema.postViewTotalTable.postId, postId))
          .limit(1);

        const windowViews = yield* db
          .select({ views: sql<number>`count(*)::int` })
          .from(schema.postViewEventTable)
          .where(
            and(
              eq(schema.postViewEventTable.postId, postId),
              gte(schema.postViewEventTable.occurredAt, since)
            )
          );

        const countries = yield* breakdown(schema.postViewEventTable.country, {
          postId,
          since,
        });
        const devices = yield* breakdown(schema.postViewEventTable.device, {
          postId,
          since,
        });
        const browsers = yield* breakdown(schema.postViewEventTable.browser, {
          postId,
          since,
        });
        const os = yield* breakdown(schema.postViewEventTable.os, {
          postId,
          since,
        });

        // SAFETY: every breakdown selects the same two columns under the same
        // names, and `value` is a non-null text column, so the rows match the
        // schema's shape without a decode.
        const toDimension = (rows: { value: string; views: number }[]) =>
          rows as TPostViewDimensionCount[];

        return Option.some<TPostTraffic>({
          last30Days: {
            browsers: toDimension(browsers),
            countries: toDimension(countries),
            devices: toDimension(devices),
            os: toDimension(os),
            views: windowViews[0]?.views ?? 0,
          },
          postId,
          views: totals[0]?.views ?? 0,
        });
      }),

    /**
     * Drop raw events older than `before`.
     *
     * The counter is never touched: the all-time number is the row on
     * `postViewTotalTable`, and only the breakdown data ages out. Deleting a
     * post still cascades both tables, which is the erasure path.
     */
    deleteEventsBefore: (before: Date) =>
      db
        .delete(schema.postViewEventTable)
        .where(lt(schema.postViewEventTable.occurredAt, before)),
  };
});

export class PostTrafficRepository extends Context.Service<PostTrafficRepository>()(
  "PostTrafficRepository",
  {
    make: makePostTrafficRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
