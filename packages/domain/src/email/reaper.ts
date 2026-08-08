import * as Cron from "effect/Cron";
import * as Effect from "effect/Effect";
import { ClusterCron } from "effect/unstable/cluster";
import { EmailEventRepository } from "./repository";

const REAPER_BATCH_SIZE = 50;

/**
 * Slow periodic re-schedule of due email events. Without this, a dormant
 * workspace's pending events would only drain on the next mutation; the
 * reaper guarantees `available_at`-past rows are re-scheduled even when
 * nothing new happens. Owned by the cluster (ClusterCron sharding), so only
 * one runner executes it at a time.
 */
export const EmailReaperCron = ClusterCron.make({
  name: "email-event-reaper",
  cron: Cron.parseUnsafe("*/5 * * * *"),
  execute: Effect.gen(function* () {
    const repository = yield* EmailEventRepository;

    const due = yield* repository.findDueEvents(REAPER_BATCH_SIZE);

    yield* Effect.forEach(
      due,
      (event) =>
        repository.scheduleEvent(event.id, event.organizationId).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to re-schedule due email event",
              cause
            ).pipe(
              Effect.annotateLogs({
                eventId: event.id,
                organizationId: event.organizationId,
              })
            )
          )
        ),
      { concurrency: 4 }
    );

    if (due.length > 0) {
      yield* Effect.logInfo("Re-scheduled due email events", {
        count: due.length,
      });
    }
  }),
});
