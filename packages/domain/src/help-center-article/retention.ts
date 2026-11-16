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

/** Once a day is plenty for a table that grows at human page-view rate. */
const RETENTION_PASS_INTERVAL = "24 hours";

/**
 * The raw-event retention pass.
 *
 * A failed pass is logged rather than allowed to kill the scope: an unreachable
 * database is transient and the next pass is the retry. Interruption still
 * propagates, so the loop dies with the program that owns it — the same
 * contract as the post-traffic and audit-log sweeps.
 */
export const helpCenterArticleViewRetention = Effect.gen(function* () {
  const repository = yield* HelpCenterArticleRepository;
  const now = yield* DateTime.now;

  const before = DateTime.toDate(
    DateTime.subtract({ days: HELP_CENTER_ARTICLE_VIEW_RETENTION_DAYS })(now)
  );

  yield* repository.deleteEventsBefore(before);
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
