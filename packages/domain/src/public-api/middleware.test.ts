import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as ErrorReporter from "effect/ErrorReporter";
import { HttpApiError } from "effect/http-api";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { rejectRequest } from "./middleware";

/** A decode failure of one request part, built the way the framework builds it. */
const schemaRejection = (kind: HttpApiError.HttpApiSchemaError["kind"]) =>
  Schema.decodeUnknownEffect(Schema.Finite)("not-a-number").pipe(
    Effect.flip,
    Effect.map((cause) => new HttpApiError.HttpApiSchemaError({ kind, cause }))
  );

/** A reporter that only remembers, so the test reads what reached the boundary. */
const collectingReporter = () => {
  const causes: Array<Cause.Cause<unknown>> = [];
  const reporter: ErrorReporter.ErrorReporter = {
    [ErrorReporter.TypeId]: ErrorReporter.TypeId,
    report: ({ cause }) => {
      causes.push(cause);
    },
  };
  return { causes, reporter };
};

const reported = (cause: Cause.Cause<unknown> | undefined) =>
  cause === undefined
    ? undefined
    : Option.getOrUndefined(Cause.findErrorOption(cause));

const answer = (
  error: HttpApiError.HttpApiSchemaError,
  reporter: ErrorReporter.ErrorReporter
) =>
  rejectRequest(error).pipe(
    Effect.provideService(
      ErrorReporter.CurrentErrorReporters,
      new Set([reporter])
    ),
    // The transform always fails; flipping makes the failure the value.
    Effect.flip
  );

describe("rejectRequest", () => {
  it.effect(
    "reports the schema rejection and answers a request-part failure with INVALID_REQUEST",
    () =>
      Effect.gen(function* () {
        const { causes, reporter } = collectingReporter();
        const rejection = yield* schemaRejection("Payload");

        const failure = yield* answer(rejection, reporter);

        expect(failure).toMatchObject({
          _tag: "INVALID_REQUEST",
          message: "The request body is not valid for this endpoint.",
        });
        expect(causes).toHaveLength(1);
        expect(reported(causes[0])).toBe(rejection);
      })
  );

  it.effect(
    "re-fails a response-encoding failure unchanged, because it is a server defect",
    () =>
      Effect.gen(function* () {
        const { causes, reporter } = collectingReporter();
        const rejection = yield* schemaRejection("Body");

        const failure = yield* answer(rejection, reporter);

        expect(failure).toBe(rejection);
        expect(causes).toHaveLength(0);
      })
  );
});
