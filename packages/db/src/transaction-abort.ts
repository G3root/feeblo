import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

/**
 * SQLSTATE codes for the aborts Postgres raises itself, where the transaction
 * has already been rolled back and the correct response is to run it again.
 *
 * - `40001` `serialization_failure`: the transaction lost a serializable
 *   conflict.
 * - `40P01` `deadlock_detected`: Postgres picked this transaction as the victim
 *   of a lock cycle and aborted it.
 * - `55P03` `lock_not_available`: the transaction's `lock_timeout` expired
 *   while waiting for a lock, so the statement never ran.
 *
 * The three share the property that re-running the transaction is safe and is
 * the only correct recovery. Every other error — a unique violation, a
 * foreign-key violation, a syntax error — is deterministic and would fail
 * identically on a retry, so none is listed.
 */
const retryableTransactionAbortCodes = new Set(["40001", "40P01", "55P03"]);

/**
 * A pg driver error. Every layer that wraps one leaves its SQLSTATE reachable
 * under `code`.
 */
const DriverError = Schema.Struct({ code: Schema.String });

/**
 * One level of wrapping around a driver error.
 *
 * A query failure reaches a caller through three shapes, all of them present in
 * production today: the driver error itself, an Effect `Cause` whose
 * `reasons[].error` is that driver error, and an `EffectDrizzleQueryError`
 * whose `cause` is a `SqlError` whose `cause` is that driver error. The shape
 * differs by how the query was issued — drizzle's effect adapter, a raw
 * `SqlClient.execute`, or a statement inside `db.transaction` — so a fixed path
 * would miss real aborts.
 *
 * Every field is optional and the decoder ignores excess properties, so this
 * matches any object and answers `undefined` when none of the keys is present.
 */
const Wrapper = Schema.Struct({
  cause: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
  reason: Schema.optional(Schema.Unknown),
  reasons: Schema.optional(Schema.Array(Schema.Unknown)),
});

/** The values a wrapper can carry, in the order they are searched. */
const unwrap = (wrapper: typeof Wrapper.Type): readonly unknown[] => [
  wrapper.cause,
  wrapper.error,
  wrapper.reason,
  ...(wrapper.reasons ?? []),
];

/**
 * Finds the SQLSTATE of a query failure, or `undefined` when the failure did
 * not come from Postgres.
 *
 * The walk is bounded because the wrapper chain has a fixed depth — three
 * today — and a self-referential `cause` is a realistic way for a wrapper to
 * cycle.
 */
// The input is the error channel of an arbitrary effect, so its shape is not
// known at the call site by construction. Both decoders below run before any
// field is read, which is the boundary parse the rule asks for.
// eslint-disable-next-line anti-slop/no-unknown-parameters -- SQLSTATE extraction is the decoder boundary for an error of unknown shape.
export const sqlStateOf = (error: unknown, depth = 0): string | undefined => {
  if (depth > 6) {
    return undefined;
  }
  const driver = Option.getOrUndefined(
    Schema.decodeUnknownOption(DriverError)(error)
  );
  if (driver !== undefined) {
    // A driver error's code is authoritative: a non-retryable one stops the
    // walk instead of searching its own fields for a retryable code.
    return retryableTransactionAbortCodes.has(driver.code)
      ? driver.code
      : undefined;
  }
  const wrapper = Option.getOrUndefined(
    Schema.decodeUnknownOption(Wrapper)(error)
  );
  if (wrapper === undefined) {
    return undefined;
  }
  for (const inner of unwrap(wrapper)) {
    const found = sqlStateOf(inner, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

/**
 * Whether `error` is a transaction abort that Postgres rolled back cleanly and
 * that a caller should retry by running the transaction again.
 *
 * `unknown` rather than a generic: this is used as the `while` predicate of
 * `Effect.retry`, where the channel is any error type the retried effect
 * declares.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- see above: the value is decoded, never asserted.
export const isRetryableTransactionAbort = (error: unknown): boolean =>
  sqlStateOf(error) !== undefined;

/**
 * Three attempts at most: the initial one and two retries. An abort means the
 * transaction did no work, so a retry costs one round-trip plus the jitter; a
 * fourth attempt would only add latency to a request that is already under
 * contention.
 */
const transactionAbortRetryPolicy = Schedule.jittered(
  Schedule.exponential("25 millis")
).pipe(
  Schedule.upTo({ times: 2 }),
  Schedule.tap(({ attempt }) =>
    Effect.logWarning(
      `[Database client]: transaction aborted by Postgres; retrying (attempt ${attempt}).`
    )
  )
);

/**
 * Re-runs `effect` when it failed with a retryable transaction abort.
 *
 * Apply this to the transaction boundary, not to a statement inside it: an
 * abort rolls the whole transaction back, so retrying one statement inside it
 * would fail with `25P02` (`in_failed_sql_transaction`) instead of recovering.
 *
 * The retried effect must describe database work only. Effect SQL rolls the
 * transaction back on failure, so replaying it is safe; a network call made
 * inside the effect would be replayed too, which is why the codebase keeps
 * every external call outside the transaction.
 */
export const withTransactionAbortRetry = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.retry({
      schedule: transactionAbortRetryPolicy,
      while: isRetryableTransactionAbort,
    }),
    Effect.tapError((error) =>
      isRetryableTransactionAbort(error)
        ? Effect.logWarning(
            `[Database client]: transaction kept failing with SQLSTATE ${sqlStateOf(error)}; giving up.`
          )
        : Effect.void
    )
  );
