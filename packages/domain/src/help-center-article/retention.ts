import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { HelpCenterArticleRepository } from "./repository";

/**
 * How long a raw read event is kept.
 *
 * The all-time count lives on `help_center_article_view_total` and is never
 * pruned, so this window only bounds what the windowed reads can answer. A
 * quarter matches the post-traffic window, and matching it is the point: two
 * different retention periods for two view counters would be a difference
 * nobody could explain later.
 */
export const HELP_CENTER_ARTICLE_VIEW_RETENTION_DAYS = 90;

/**
 * How long a search bucket is kept.
 *
 * Matches the article view window, and the analytics panel's longest range:
 * 90 days plus today is every day a window can ask for, so the prune can never
 * remove a row a page still reports on.
 */
export const HELP_CENTER_SEARCH_RETENTION_DAYS = 90;

/** Once a day is plenty for a table that grows at human page-view rate. */
const RETENTION_PASS_INTERVAL = "24 hours";

/** The tables the sweep prunes, so a failure names its own. */
export type HelpCenterRetentionTarget = "article_view_events" | "searches";

/**
 * A pass in which at least one table's prune failed.
 *
 * Each failure is already logged with its cause where it happened; this exists
 * so the pass as a whole still reports failure, which is what keeps a broken
 * prune from looking like a clean run for a week.
 */
export class HelpCenterRetentionError extends Data.TaggedError(
  "HelpCenterRetentionError"
)<{ readonly failed: readonly HelpCenterRetentionTarget[] }> {}

/**
 * The help center's daily sweep: raw read events, and search buckets.
 *
 * Two tables with different shapes and the same question — how long do the
 * rows behind a windowed read live — so one pass prunes both. The search
 * buckets are why this exists at all: their key is the reader's text, which is
 * the only table here that grows with what people type rather than with what
 * the workspace publishes.
 *
 * A failed pass is logged rather than allowed to kill the scope: an unreachable
 * database is transient and the next pass is the retry. Interruption still
 * propagates, so the loop dies with the program that owns it — the same
 * contract as the post-traffic and audit-log sweeps.
 */
export const helpCenterRetention = Effect.gen(function* () {
  const repository = yield* HelpCenterArticleRepository;
  const now = yield* DateTime.now;

  const eventsBefore = DateTime.toDate(
    DateTime.subtract({ days: HELP_CENTER_ARTICLE_VIEW_RETENTION_DAYS })(now)
  );

  // A day, not an instant: the bucket's key is a UTC calendar day, and the
  // comparison is `day < before`, so the cut day itself survives. With a
  // 90-day window and a 90-day analytics range (today and the 89 before it),
  // the prune can never reach a day a panel still asks for.
  const searchesBefore = DateTime.formatIsoDateUtc(
    DateTime.subtract({ days: HELP_CENTER_SEARCH_RETENTION_DAYS })(now)
  );

  // One prune per table, each absorbing its own failure into an outcome. Run
  // together they would be fail-fast: one table's bad day would cancel the
  // other's delete, so a table that can never be pruned would keep the working
  // one from ever being pruned either.
  const prune = <E>(
    target: HelpCenterRetentionTarget,
    effect: Effect.Effect<void, E>
  ) =>
    effect.pipe(
      Effect.tapCause((cause) =>
        Effect.logError(`Failed to prune ${target}`, cause)
      ),
      Effect.as(true),
      Effect.catchCause(() => Effect.succeed(false))
    );

  const [viewsPruned, searchesPruned] = yield* Effect.all(
    [
      prune("article_view_events", repository.deleteEventsBefore(eventsBefore)),
      prune("searches", repository.deleteSearchesBefore(searchesBefore)),
    ],
    { concurrency: "unbounded" }
  );

  const failed = [
    ...(viewsPruned ? [] : ["article_view_events" as const]),
    ...(searchesPruned ? [] : ["searches" as const]),
  ];

  if (failed.length > 0) {
    return yield* new HelpCenterRetentionError({ failed });
  }
}).pipe(
  Effect.tap(() => Effect.logDebug("Ran the help-center retention pass")),
  Effect.catch((error) =>
    Effect.logError("help-center retention pass failed", error)
  ),
  Effect.catchDefect((defect) =>
    Effect.logError("help-center retention pass defected", defect)
  ),
  Effect.repeat(Schedule.spaced(RETENTION_PASS_INTERVAL))
);
