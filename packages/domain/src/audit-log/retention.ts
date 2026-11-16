import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { AuditLogRepository } from "./repository";

/**
 * How long an entry is kept.
 *
 * A year answers the question an audit log exists for — "what changed in this
 * workspace, and who changed it" — and keeps the table bounded without a
 * partition scheme. It is deliberately uniform: a plan-shaped retention would
 * make a downgrade delete evidence, which is the one thing a record of
 * authority must not do quietly.
 */
export const AUDIT_LOG_RETENTION_DAYS = 365;

/** Once a day is plenty for a table that grows at human action rate. */
const RETENTION_PASS_INTERVAL = "24 hours";

/**
 * Rows per statement. Modest on purpose: each batch is its own transaction, so
 * a sweep of a large table never holds a lock a writer would wait on.
 */
const RETENTION_BATCH_SIZE = 5_000;

/**
 * One sweep: delete every batch older than the cutoff, then stop.
 *
 * Exported apart from the loop so a test can run exactly one pass instead of
 * waiting on a day-long schedule.
 */
export const runAuditLogRetentionPass = Effect.fn("AuditLogRetention.runPass")(
  function* () {
    const repository = yield* AuditLogRepository;
    const now = yield* DateTime.now;
    const cutoff = DateTime.toDate(
      DateTime.subtract({ days: AUDIT_LOG_RETENTION_DAYS })(now)
    );

    let removed = 0;
    let batch = yield* repository.deleteBefore(cutoff, RETENTION_BATCH_SIZE);
    while (batch === RETENTION_BATCH_SIZE) {
      removed += batch;
      batch = yield* repository.deleteBefore(cutoff, RETENTION_BATCH_SIZE);
    }
    removed += batch;

    return yield* Effect.logDebug("Ran the audit-log retention pass").pipe(
      Effect.annotateLogs({ removed }),
      Effect.as(removed)
    );
  }
);

/**
 * The retention loop.
 *
 * A failed pass is logged rather than allowed to kill the scope: an
 * unreachable database is transient and the next pass is the retry.
 * Interruption still propagates, so the loop dies with the program that owns
 * it.
 */
export const auditLogRetention = runAuditLogRetentionPass().pipe(
  Effect.catch((error) =>
    Effect.logError("audit-log retention pass failed", error)
  ),
  Effect.catchDefect((defect) =>
    Effect.logError("audit-log retention pass defected", defect)
  ),
  Effect.repeat(Schedule.spaced(RETENTION_PASS_INTERVAL))
);
