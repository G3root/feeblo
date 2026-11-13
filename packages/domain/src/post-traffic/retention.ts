import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { PostTrafficRepository } from "./repository";

/**
 * How long a raw event answers the breakdown.
 *
 * The all-time count lives on the counter and is never pruned. A quarter is
 * enough to answer "where did this month's views come from" and keeps the
 * table bounded by the same window the dashboard reads.
 */
export const POST_VIEW_RETENTION_DAYS = 90;

/** Once a day is plenty for a table that only grows at human page-view rate. */
const RETENTION_PASS_INTERVAL = "24 hours";

/**
 * The raw-event retention pass.
 *
 * Like the other maintenance loops, a failed pass is logged rather than
 * allowed to kill the scope: an unreachable database is transient, and the
 * next pass is the retry. Interruption still propagates so the loop dies with
 * the program that owns it.
 */
export const postTrafficRetention = Effect.gen(function* () {
  const repository = yield* PostTrafficRepository;
  const now = yield* DateTime.now;
  const before = DateTime.toDate(
    DateTime.subtract({ days: POST_VIEW_RETENTION_DAYS })(now)
  );
  yield* repository.deleteEventsBefore(before);
}).pipe(
  Effect.tap(() => Effect.logDebug("Ran the post-traffic retention pass")),
  Effect.catch((error) =>
    Effect.logError("post-traffic retention pass failed", error)
  ),
  Effect.catchDefect((defect) =>
    Effect.logError("post-traffic retention pass defected", defect)
  ),
  Effect.repeat(Schedule.spaced(RETENTION_PASS_INTERVAL))
);
