import { describe, expect, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";

import {
  isRetryableTransactionAbort,
  sqlStateOf,
  withTransactionAbortRetry,
} from "./transaction-abort";

/**
 * The shape a driver error takes when drizzle's Effect adapter reports it: the
 * pg error sits directly on `cause`.
 */
const drizzleQueryError = (code: string) =>
  new EffectDrizzleQueryError({
    query: 'insert into "post" ...',
    params: [],
    cause: { code, constraint: undefined },
  });

/**
 * The shape Effect SQL reports when the failure reached it as a Cause: the
 * driver error is nested under `reasons[].error`.
 */
const causeWrappedError = (code: string) => {
  const failure = Cause.fail({ code, detail: "deadlock detected" });
  return { "~effect/Cause": "~effect/Cause", reasons: failure.reasons };
};

/**
 * The shape a failure takes once a `SqlError` has wrapped the driver error.
 */
const sqlErrorWrappedError = (code: string) =>
  new EffectDrizzleQueryError({
    query: "select 1",
    params: [],
    cause: { cause: { cause: { code } } },
  });

describe("sqlStateOf", () => {
  it("reads the SQLSTATE from every wrapper shape the driver reports", () => {
    expect(sqlStateOf(drizzleQueryError("40P01"))).toBe("40P01");
    expect(sqlStateOf(causeWrappedError("40001"))).toBe("40001");
    expect(sqlStateOf(sqlErrorWrappedError("55P03"))).toBe("55P03");
  });

  it("answers undefined for a failure that is not a retryable abort", () => {
    expect(sqlStateOf(new Error("connection refused"))).toBeUndefined();
    expect(sqlStateOf(drizzleQueryError("23505"))).toBeUndefined();
    expect(sqlStateOf(undefined)).toBeUndefined();
    expect(sqlStateOf("40P01")).toBeUndefined();
  });

  it("terminates on a self-referential cause instead of recursing forever", () => {
    const cyclic = Object.assign({}, { cause: {} });
    cyclic.cause = cyclic;
    expect(sqlStateOf(cyclic)).toBeUndefined();
  });
});

describe("isRetryableTransactionAbort", () => {
  it("treats the three aborts Postgres rolls back cleanly as retryable", () => {
    expect(isRetryableTransactionAbort(drizzleQueryError("40P01"))).toBe(true);
    expect(isRetryableTransactionAbort(drizzleQueryError("40001"))).toBe(true);
    expect(isRetryableTransactionAbort(drizzleQueryError("55P03"))).toBe(true);
  });

  it("does not retry a deterministic failure", () => {
    expect(isRetryableTransactionAbort(drizzleQueryError("23505"))).toBe(false);
    expect(isRetryableTransactionAbort(new Error("boom"))).toBe(false);
  });
});

describe("withTransactionAbortRetry", () => {
  // `it.live`, not `it.effect`: the retry policy sleeps, and the test clock
  // would suspend rather than advance it. The whole file runs in well under a
  // second even on a live clock.
  it.live("re-runs the transaction and succeeds on the retry", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const result = yield* withTransactionAbortRetry(
        Effect.gen(function* () {
          const attempt = yield* Ref.updateAndGet(attempts, (n) => n + 1);
          if (attempt === 1) {
            return yield* drizzleQueryError("40P01");
          }
          return attempt;
        })
      );

      expect(result).toBe(2);
      expect(yield* Ref.get(attempts)).toBe(2);
    })
  );

  it.live("re-runs a transaction that timed out waiting for a lock", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      yield* withTransactionAbortRetry(
        Effect.gen(function* () {
          yield* Ref.update(attempts, (n) => n + 1);
          return yield* drizzleQueryError("55P03");
        })
      ).pipe(Effect.exit);

      expect(yield* Ref.get(attempts)).toBe(3);
    })
  );

  it.live("gives up after two retries and surfaces the last failure", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const exit = yield* withTransactionAbortRetry(
        Effect.gen(function* () {
          yield* Ref.update(attempts, (n) => n + 1);
          return yield* drizzleQueryError("40001");
        })
      ).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* Ref.get(attempts)).toBe(3);
    })
  );

  it.live("does not retry a deterministic failure", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      yield* withTransactionAbortRetry(
        Effect.gen(function* () {
          yield* Ref.update(attempts, (n) => n + 1);
          return yield* drizzleQueryError("23505");
        })
      ).pipe(Effect.exit);

      expect(yield* Ref.get(attempts)).toBe(1);
    })
  );
});
