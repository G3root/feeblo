import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

/**
 * The SQLSTATEs Postgres raises itself after it has already rolled the
 * transaction back, where running the transaction again is the only correct
 * recovery.
 *
 * - `40001` `serialization_failure`: the transaction lost a serializable
 *   conflict.
 * - `40P01` `deadlock_detected`: Postgres picked this transaction as the victim
 *   of a lock cycle and aborted it.
 * - `55P03` `lock_not_available`: the transaction's `lock_timeout` expired
 *   while waiting for a lock, so the statement never ran.
 *
 * Every other error — a unique violation, a foreign-key violation, a syntax
 * error — is deterministic and would fail identically on a retry, so the
 * vocabulary stays closed rather than growing a catch-all.
 */
const transactionAbortCodes = ["40001", "40P01", "55P03"] as const;

/** A SQLSTATE that means "the transaction was rolled back; run it again". */
type TransactionAbortCode = (typeof transactionAbortCodes)[number];

/**
 * Whether a driver's SQLSTATE is one of the aborts above.
 *
 * A linear comparison over a three-element tuple rather than a `Set`, because
 * the narrowing it returns is what makes a claimed `TransactionAbortCode`
 * trustworthy.
 */
const isTransactionAbortCode = (code: string): code is TransactionAbortCode =>
  transactionAbortCodes.some((abortCode) => abortCode === code);

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
 * matches any object and answers nothing when none of the keys is present.
 */
const FailureWrapper = Schema.Struct({
  cause: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
  reason: Schema.optional(Schema.Unknown),
  reasons: Schema.optional(Schema.Array(Schema.Unknown)),
});

/** The values a wrapper can carry, in the order they are searched. */
const wrappedFailures = (
  wrapper: typeof FailureWrapper.Type
): ReadonlyArray<unknown> => [
  wrapper.cause,
  wrapper.error,
  wrapper.reason,
  ...(wrapper.reasons ?? []),
];

/**
 * The wrapper chain has a fixed depth — three today. A self-referential `cause`
 * is a realistic way for one to cycle, so the walk is bounded rather than
 * trusting the shape.
 */
const maxWrapperDepth = 6;

/**
 * Reads the transaction-abort SQLSTATE out of a query failure.
 *
 * The input is the error channel of an arbitrary effect, so its shape is
 * genuinely unknown; both decoders run before any field is read, which is the
 * boundary parse that makes the `unknown` input honest. Nothing here asserts on
 * the value.
 */
const abortCodeOf = (
  // The input is the error channel of an arbitrary effect, so its shape is not
  // known by construction; both decoders below run before any field is read.
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- SQLSTATE extraction is the decoder boundary for an error whose shape is unknown by construction.
  error: unknown,
  depth = 0
): Option.Option<TransactionAbortCode> => {
  if (depth > maxWrapperDepth) {
    return Option.none();
  }
  const driverError = Option.getOrUndefined(
    Schema.decodeUnknownOption(DriverError)(error)
  );
  if (driverError !== undefined) {
    // A driver error's code is authoritative: a non-abort one ends the walk
    // instead of searching its own fields for an abort code it did not report.
    return isTransactionAbortCode(driverError.code)
      ? Option.some(driverError.code)
      : Option.none();
  }
  const wrapper = Option.getOrUndefined(
    Schema.decodeUnknownOption(FailureWrapper)(error)
  );
  if (wrapper === undefined) {
    return Option.none();
  }
  for (const inner of wrappedFailures(wrapper)) {
    const found = abortCodeOf(inner, depth + 1);
    if (Option.isSome(found)) {
      return found;
    }
  }
  return Option.none();
};

/**
 * Attaches the failure an already-mapped error replaces.
 *
 * For an `Effect.mapError` inside a transaction. `Schema.TaggedError` carries no
 * cause unless the schema declares a field for one, and declaring one on a
 * client-facing error would ship the driver failure — SQL text included — in the
 * response. The attachment is therefore a plain property: the retry's walk reads
 * it, the error's schema never encodes it, and the caller sees the shape its
 * contract promised.
 *
 * @param error - The error to return, already shaped for the caller.
 * @param cause - The failure it replaces, kept for the retry and for diagnosis.
 * @returns `error`, with `cause` attached.
 */
export const attachCause = <E extends Error, C>(error: E, cause: C): E =>
  Object.assign(error, { cause });

/**
 * Three attempts at most: the initial one and two retries. An abort means the
 * transaction did no work, so a retry costs one round-trip plus the jitter; a
 * fourth attempt would only add latency to a request already under contention.
 */
const transactionAbortRetrySchedule = Schedule.exponential("25 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 2 }),
  Schedule.tap(({ attempt }) =>
    Effect.logWarning(
      `[Database client]: transaction aborted by Postgres; retrying (attempt ${attempt}).`
    )
  )
);

/**
 * Re-runs `effect` when it failed with a transaction abort Postgres raised.
 *
 * Apply this to the transaction boundary, not to a statement inside it: an abort
 * rolls the whole transaction back, so retrying one statement inside it fails
 * with `25P02` (`in_failed_sql_transaction`) instead of recovering.
 *
 * Calling it is a statement about the operation, not about this helper: the
 * effect must be safe to run twice. Effect SQL rolls the transaction back on
 * failure, so replaying database work is safe. A network call made inside the
 * effect would be replayed too, which is why the codebase keeps every external
 * call outside the transaction.
 *
 * @param effect - The transaction to run, and to run again if Postgres aborted it.
 * @returns The transaction's result, or its failure once the retries are exhausted.
 */
export const withTransactionAbortRetry = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.retry({
      schedule: transactionAbortRetrySchedule,
      while: (error) => Option.isSome(abortCodeOf(error)),
    }),
    Effect.tapError((error) =>
      Option.match(abortCodeOf(error), {
        onNone: () => Effect.void,
        onSome: (abortCode) =>
          Effect.logWarning(
            `[Database client]: transaction kept aborting with SQLSTATE ${abortCode}; giving up.`
          ),
      })
    )
  );
