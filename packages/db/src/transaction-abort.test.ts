import { describe, expect, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";

import { attachCause, withTransactionAbortRetry } from "./transaction-abort";

/**
 * The shape a driver error takes when drizzle's Effect adapter reports it: the
 * pg error sits directly on `cause`.
 */
const driverFailure = (code: string) =>
  new EffectDrizzleQueryError({
    query: 'insert into "post" ...',
    params: [],
    cause: { code, constraint: undefined },
  });

/**
 * The shape Effect SQL reports when the failure reached it as a Cause: the
 * driver error is nested under `reasons[].error`.
 */
const causeWrappedFailure = (code: string) => {
  const failure = Cause.fail({ code, detail: "aborted" });
  return { "~effect/Cause": "~effect/Cause", reasons: failure.reasons };
};

/**
 * The shape a failure takes once a `SqlError` has wrapped the driver error.
 */
const sqlErrorWrappedFailure = (code: string) =>
  new EffectDrizzleQueryError({
    query: "select 1",
    params: [],
    cause: { cause: { cause: { code } } },
  });

/**
 * A transaction that always fails with `failure`, counting how many times it
 * ran.
 *
 * The retry policy is private, so the tests observe it the way a caller does:
 * how many times the transaction ran, and what came out when it never
 * succeeded.
 */
const failedTransaction = <E>(
  failure: E,
  attempts: Ref.Ref<number>
): Effect.Effect<never, E> =>
  Ref.update(attempts, (count) => count + 1).pipe(
    Effect.andThen(Effect.fail(failure))
  );

describe("withTransactionAbortRetry", () => {
  // `it.live`, not `it.effect`: the retry policy sleeps, and the test clock
  // would suspend rather than advance it. The whole file runs in well under a
  // second on a live clock, and the assertions are attempt counts, not timing.
  it.live("re-runs a transaction Postgres aborted and succeeds", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const result = yield* withTransactionAbortRetry(
        Effect.gen(function* () {
          const attempt = yield* Ref.updateAndGet(attempts, (n) => n + 1);
          if (attempt === 1) {
            return yield* driverFailure("40P01");
          }
          return attempt;
        })
      );

      expect(result).toBe(2);
      expect(yield* Ref.get(attempts)).toBe(2);
    })
  );

  // One case per wrapper shape, because reading a fixed path would silently
  // miss two of the three failures production actually produces.
  it.live("retries a deadlock reported by drizzle", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      yield* withTransactionAbortRetry(
        failedTransaction(driverFailure("40P01"), attempts)
      ).pipe(Effect.exit);

      expect(yield* Ref.get(attempts)).toBe(3);
    })
  );

  it.live("retries a serialization failure reported as a cause", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      yield* withTransactionAbortRetry(
        failedTransaction(causeWrappedFailure("40001"), attempts)
      ).pipe(Effect.exit);

      expect(yield* Ref.get(attempts)).toBe(3);
    })
  );

  it.live("retries a lock timeout reported through a SqlError", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      yield* withTransactionAbortRetry(
        failedTransaction(sqlErrorWrappedFailure("55P03"), attempts)
      ).pipe(Effect.exit);

      expect(yield* Ref.get(attempts)).toBe(3);
    })
  );

  it.live("gives up after two retries and surfaces the last failure", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const exit = yield* withTransactionAbortRetry(
        failedTransaction(driverFailure("40001"), attempts)
      ).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* Ref.get(attempts)).toBe(3);
    })
  );

  it.live("does not retry a failure that is not a transaction abort", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      yield* withTransactionAbortRetry(
        failedTransaction(driverFailure("23505"), attempts)
      ).pipe(Effect.exit);

      expect(yield* Ref.get(attempts)).toBe(1);
    })
  );

  it.live("does not retry a failure that is not an object", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      yield* withTransactionAbortRetry(
        failedTransaction("not a database error", attempts)
      ).pipe(Effect.exit);

      expect(yield* Ref.get(attempts)).toBe(1);
    })
  );

  it.live(
    "terminates on a self-referential cause instead of recursing forever",
    () =>
      Effect.gen(function* () {
        const cyclic = Object.assign({}, { cause: {} });
        cyclic.cause = cyclic;

        const attempts = yield* Ref.make(0);
        yield* withTransactionAbortRetry(
          failedTransaction(cyclic, attempts)
        ).pipe(Effect.exit);

        expect(yield* Ref.get(attempts)).toBe(1);
      })
  );
});

describe("attachCause", () => {
  it.live(
    "keeps the abort reachable through the error a mapping returned",
    () =>
      Effect.gen(function* () {
        // The shape a boundary produces: a contract error wrapping the failure it
        // replaced. `Schema.TaggedError` drops a cause it does not declare, so the
        // attachment has to be explicit.
        const mapped = attachCause(
          new Error("Could not record integration event."),
          driverFailure("55P03")
        );

        const attempts = yield* Ref.make(0);
        yield* withTransactionAbortRetry(
          failedTransaction(mapped, attempts)
        ).pipe(Effect.exit);

        expect(yield* Ref.get(attempts)).toBe(3);
      })
  );

  it.live("keeps the abort reachable through a chain of wrappers", () =>
    Effect.gen(function* () {
      // The depth a comment status update produces: the database failure, the
      // recorder's wrapper, the event wrapper, the intent wrapper, and the
      // operation's own error. The walk has to reach the bottom of that, so a
      // caller cannot shorten the chain by re-wrapping without the cause.
      const recorder = attachCause(
        new Error("recorder"),
        driverFailure("40P01")
      );
      const event = attachCause(new Error("event"), recorder);
      const intent = attachCause(new Error("intent"), event);
      const operation = attachCause(new Error("operation"), intent);

      const attempts = yield* Ref.make(0);
      yield* withTransactionAbortRetry(
        failedTransaction(operation, attempts)
      ).pipe(Effect.exit);

      expect(yield* Ref.get(attempts)).toBe(3);
    })
  );
});
