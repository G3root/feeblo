import { currentDb, schema } from "@feeblo/db";
import { HelpCenterArticleFeedbackId } from "@feeblo/id";
import { and, count, desc, eq, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { THelpCenterArticleFeedbackPublic } from "./schema";

const feedback = schema.helpCenterArticleFeedbackTable;

const article = schema.helpCenterArticleTable;

const viewTotal = schema.helpCenterArticleViewTotalTable;

const daily = schema.helpCenterArticleDailyTable;

/** The two counts plus this reader's verdict, for the widget. */
export type TFeedbackTally = THelpCenterArticleFeedbackPublic;

const makeHelpCenterArticleFeedbackRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const countsFor = ({
    organizationId,
    articleId,
  }: {
    organizationId: string;
    articleId: string;
  }) =>
    db
      .select({
        helpfulCount: sql<number>`count(*) filter (where ${feedback.helpful})::int`,
        notHelpfulCount: sql<number>`count(*) filter (where not ${feedback.helpful})::int`,
      })
      .from(feedback)
      .where(
        and(
          eq(feedback.organizationId, organizationId),
          eq(feedback.articleId, articleId)
        )
      )
      .pipe(
        Effect.map((rows) => rows[0] ?? { helpfulCount: 0, notHelpfulCount: 0 })
      );

  const viewCountFor = ({
    organizationId,
    articleId,
  }: {
    organizationId: string;
    articleId: string;
  }) =>
    db
      .select({ views: viewTotal.views })
      .from(viewTotal)
      .innerJoin(article, eq(article.id, viewTotal.articleId))
      .where(
        and(
          eq(article.organizationId, organizationId),
          eq(viewTotal.articleId, articleId)
        )
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]?.views ?? 0));

  /**
   * The reader's own verdict.
   *
   * Two identity facets, never both: the query asks for the signed-in row when
   * there is one, and for the browser-keyed row otherwise. A signed-in reader
   * who also carries a visitor id keeps the account row, so signing in does not
   * appear to lose a vote they already cast.
   */
  const findMine = ({
    organizationId,
    articleId,
    userId,
    visitorId,
  }: {
    organizationId: string;
    articleId: string;
    userId: string | null;
    visitorId: string | null;
  }) =>
    db
      .select({ helpful: feedback.helpful })
      .from(feedback)
      .where(
        and(
          eq(feedback.organizationId, organizationId),
          eq(feedback.articleId, articleId),
          userId === null
            ? eq(feedback.visitorId, visitorId ?? "")
            : eq(feedback.userId, userId)
        )
      )
      .limit(1)
      .pipe(Effect.map((rows) => rows[0]?.helpful ?? null));

  const tally = ({
    organizationId,
    articleId,
    userId,
    visitorId,
  }: {
    organizationId: string;
    articleId: string;
    userId: string | null;
    visitorId: string | null;
  }) =>
    Effect.gen(function* () {
      const [counts, viewCount, mine] = yield* Effect.all(
        [
          countsFor({ organizationId, articleId }),
          viewCountFor({ organizationId, articleId }),
          findMine({ organizationId, articleId, userId, visitorId }),
        ],
        { concurrency: "unbounded" }
      );

      return { viewCount, ...counts, mine };
    });

  /**
   * Record or flip one reader's verdict.
   *
   * The write is a single statement against the partial unique index that
   * matches the reader's identity facet, so a double-click cannot create a
   * second row and cannot create a second vote: the conflict target *is* the
   * dedupe rule declared on the table.
   *
   * A flip is an `UPDATE` of the same row rather than a second row, which is
   * what keeps the two counts summing to one verdict per reader. Flipping to
   * helpful clears `reason`, because a reason explains the unhelpful vote it
   * was written for.
   */
  const cast = ({
    organizationId,
    articleId,
    userId,
    visitorId,
    helpful,
    reason,
  }: {
    organizationId: string;
    articleId: string;
    userId: string | null;
    visitorId: string | null;
    helpful: boolean;
    reason: string | null;
  }) =>
    Effect.gen(function* () {
      const now = yield* DateTime.nowAsDate;
      // Minted even when the insert conflicts: the id is the row's identity on
      // a first vote, and a discarded id on a flip costs nothing. Minting it
      // through the legid factory is what keeps it out of `crypto`, which is a
      // service an Effect program reads like `Clock`.
      const id = yield* HelpCenterArticleFeedbackId.generate;

      const conflict =
        userId === null
          ? {
              target: [feedback.articleId, feedback.visitorId],
              targetWhere: sql`${feedback.visitorId} is not null`,
            }
          : {
              target: [feedback.articleId, feedback.userId],
              targetWhere: sql`${feedback.userId} is not null`,
            };

      yield* db
        .insert(feedback)
        .values({
          id,
          organizationId,
          articleId,
          userId,
          visitorId,
          helpful,
          reason: helpful ? null : reason,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: conflict.target,
          targetWhere: conflict.targetWhere,
          set: {
            helpful,
            reason: helpful ? null : reason,
            updatedAt: now,
          },
        })
        .pipe(Effect.asVoid);

      // The day's bucket, which counts verdicts *cast* rather than the standing
      // distribution: a flip adds one to today and leaves the earlier day's
      // count alone. Deliberately not part of the verdict's own write path — a
      // counter that could fail would be a vote the reader cannot cast, so a
      // failed bucket is logged and the verdict stands.
      yield* db
        .insert(daily)
        .values({
          articleId,
          day: DateTime.formatIsoDateUtc(DateTime.fromDateUnsafe(now)),
          helpfulVerdicts: helpful ? 1 : 0,
          organizationId,
          unhelpfulVerdicts: helpful ? 0 : 1,
          views: 0,
        })
        .onConflictDoUpdate({
          target: [daily.articleId, daily.day],
          set: {
            helpfulVerdicts: sql`${daily.helpfulVerdicts} + ${helpful ? 1 : 0}`,
            unhelpfulVerdicts: sql`${daily.unhelpfulVerdicts} + ${helpful ? 0 : 1}`,
          },
        })
        .pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning("Failed to record a help center verdict", cause)
          ),
          Effect.asVoid,
          Effect.ignoreCause
        );
    });

  /**
   * The dashboard's verdict list, newest first.
   *
   * `reason` is only present on unhelpful votes, so the dashboard's "what was
   * missing" panel filters client-side rather than needing a second query.
   */
  const list = ({
    organizationId,
    articleId,
  }: {
    organizationId: string;
    articleId?: string | undefined;
  }) =>
    db
      .select({
        id: feedback.id,
        articleId: feedback.articleId,
        articleTitle: article.title,
        helpful: feedback.helpful,
        reason: feedback.reason,
        authorName: schema.userTable.name,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .innerJoin(article, eq(article.id, feedback.articleId))
      .leftJoin(schema.userTable, eq(schema.userTable.id, feedback.userId))
      .where(
        and(
          eq(feedback.organizationId, organizationId),
          articleId === undefined
            ? undefined
            : eq(feedback.articleId, articleId)
        )
      )
      .orderBy(desc(feedback.createdAt));

  /** How many verdicts the workspace holds, for the dashboard's empty state. */
  const countByOrganizationId = ({
    organizationId,
  }: {
    organizationId: string;
  }) =>
    db
      .select({ count: count() })
      .from(feedback)
      .where(eq(feedback.organizationId, organizationId))
      .pipe(Effect.map((rows) => rows[0]?.count ?? 0));

  return { tally, cast, list, countByOrganizationId };
});

export class HelpCenterArticleFeedbackRepository extends Context.Service<HelpCenterArticleFeedbackRepository>()(
  "HelpCenterArticleFeedbackRepository",
  {
    make: makeHelpCenterArticleFeedbackRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
