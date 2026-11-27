import { currentDb, schema, transaction } from "@feeblo/db";
import { HelpCenterArticleFeedbackId } from "@feeblo/id";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  HELP_CENTER_ARTICLE_FEEDBACK_LIST_DEFAULT_LIMIT,
  type THelpCenterArticleFeedbackPublic,
} from "./schema";

const feedback = schema.helpCenterArticleFeedbackTable;

const article = schema.helpCenterArticleTable;

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

  /**
   * The reader's own verdict.
   *
   * Two identity facets: the account row when there is one, and the
   * browser-keyed row as the fallback. A signed-in reader who also carries a
   * visitor id answers with the account verdict when it exists and with the
   * anonymous one otherwise, so signing in mid-vote does not appear to lose the
   * vote they already cast. The account row sorts first, which is the whole
   * rule; the fallback row is only the answer when there is no account row for
   * this article.
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
            : visitorId === null
              ? eq(feedback.userId, userId)
              : or(
                  eq(feedback.userId, userId),
                  eq(feedback.visitorId, visitorId)
                )
        )
      )
      // Booleans sort false before true, so `desc` here puts the account row
      // ahead of the anonymous fallback.
      .orderBy(desc(sql`${feedback.userId} is not null`))
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
      const [counts, mine] = yield* Effect.all(
        [
          countsFor({ organizationId, articleId }),
          findMine({ organizationId, articleId, userId, visitorId }),
        ],
        { concurrency: "unbounded" }
      );

      return { ...counts, mine };
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
   *
   * A signed-in reader can arrive carrying the browser id that voted before
   * they signed in. The account row is the verdict from then on, and the
   * anonymous row is deleted in the same transaction — otherwise the same
   * person would be counted twice, and the reader would see one count that
   * contradicts the one verdict they remember casting.
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

      const previous = yield* transaction(
        Effect.gen(function* () {
          // The effective verdict before this cast: the account row when the
          // reader is signed in, the anonymous row as the fallback. Read before
          // the upsert, so the daily bucket can tell a new judgment from a
          // repeated one.
          const previous = yield* findMine({
            organizationId,
            articleId,
            userId,
            visitorId,
          });

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
              // The row's facet: a signed-in reader is keyed to the account,
              // whatever `visitorId` the request carried.
              visitorId: userId === null ? visitorId : null,
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

          if (userId !== null && visitorId !== null) {
            yield* db
              .delete(feedback)
              .where(
                and(
                  eq(feedback.organizationId, organizationId),
                  eq(feedback.articleId, articleId),
                  eq(feedback.visitorId, visitorId)
                )
              )
              .pipe(Effect.asVoid);
          }

          return previous;
        })
      );

      // The day's bucket counts verdicts *cast*, not the standing distribution:
      // a flip adds one to today and leaves the earlier day's count alone. A
      // repeated verdict is not a new judgment — pressing No again to send a
      // reason is the same opinion — so the bucket only moves on a change.
      // Deliberately outside the verdict's own transaction: a counter that could
      // fail would be a vote the reader cannot cast, so a failed bucket is
      // logged and the verdict stands.
      if (previous === null || previous !== helpful) {
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
      }
    });

  /**
   * The dashboard's verdict list, newest first.
   *
   * `reason` is only present on unhelpful votes, so the "what was missing"
   * panel asks for `reasonsOnly` rather than filtering client-side: the filter
   * is the partial index the table already declares for this query. The list is
   * bounded by `limit` in both shapes, because a verdict history is a page of
   * recent evidence, not an export.
   */
  const list = ({
    organizationId,
    articleId,
    limit,
    reasonsOnly,
  }: {
    organizationId: string;
    articleId?: string | undefined;
    limit?: number | undefined;
    reasonsOnly?: boolean | undefined;
  }) => {
    const reasons = reasonsOnly ?? false;

    return db
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
            : eq(feedback.articleId, articleId),
          reasons ? eq(feedback.helpful, false) : undefined,
          reasons ? isNotNull(feedback.reason) : undefined
        )
      )
      .orderBy(desc(feedback.createdAt))
      .limit(limit ?? HELP_CENTER_ARTICLE_FEEDBACK_LIST_DEFAULT_LIMIT);
  };

  return { tally, cast, list };
});

export class HelpCenterArticleFeedbackRepository extends Context.Service<HelpCenterArticleFeedbackRepository>()(
  "HelpCenterArticleFeedbackRepository",
  {
    make: makeHelpCenterArticleFeedbackRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
