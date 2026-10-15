import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpApiError } from "effect/http-api";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

import {
  isRequestRejection,
  recordRequestRejections,
} from "./request-rejection";

const schemaRejection = (kind: HttpApiError.HttpApiSchemaError["kind"]) =>
  Schema.decodeUnknownEffect(Schema.Finite)("not-a-number").pipe(
    Effect.flip,
    Effect.map((cause) => new HttpApiError.HttpApiSchemaError({ kind, cause }))
  );

/** A struct whose `count` fields all fail, so every field yields its own finding. */
const manyIssuesRejection = (count: number) =>
  Schema.decodeUnknownEffect(
    Schema.Struct(
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `field${index}`,
          Schema.Finite,
        ])
      )
    ),
    { errors: "all" }
  )(
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `field${index}`,
        "not-a-number",
      ])
    )
  ).pipe(
    Effect.flip,
    Effect.map(
      (cause) => new HttpApiError.HttpApiSchemaError({ kind: "Payload", cause })
    )
  );

/** Two checks on one field, so the same path and category appear twice. */
const repeatedFindingRejection = () =>
  Schema.decodeEffect(
    Schema.Struct({
      a: Schema.Finite.check(Schema.isGreaterThan(10)).check(
        Schema.isLessThan(0)
      ),
    }),
    { errors: "all" }
  )({ a: 5 }).pipe(
    Effect.flip,
    Effect.map(
      (cause) => new HttpApiError.HttpApiSchemaError({ kind: "Payload", cause })
    )
  );

const issuesOf = (attributes: Map<string, unknown> | undefined) =>
  String(attributes?.get("feeblo.request.rejection.issues"));

const recordOnSpan = (error: HttpApiError.HttpApiSchemaError) =>
  Effect.gen(function* () {
    const { spans, tracer } = recordingTracer();
    yield* Effect.fail(error).pipe(
      Effect.withErrorReporting,
      Effect.exit,
      recordRequestRejections,
      Effect.withSpan("test.request"),
      Effect.provideService(Tracer.Tracer, tracer)
    );
    return issuesOf(spans[0]?.attributes);
  });

const recordingTracer = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, tracer };
};

it.effect(
  "recognizes a request rejection but not a response encoding failure",
  () =>
    Effect.gen(function* () {
      const payload = yield* schemaRejection("Payload");
      const response = yield* schemaRejection("Body");

      expect(isRequestRejection(payload)).toBe(true);
      expect(isRequestRejection(response)).toBe(false);
    })
);

it.effect("records the rejection's issue locations on the current span", () =>
  Effect.gen(function* () {
    const { spans, tracer } = recordingTracer();
    yield* Effect.gen(function* () {
      const error = yield* schemaRejection("Payload");
      yield* Effect.fail(error).pipe(Effect.withErrorReporting, Effect.exit);
    }).pipe(
      recordRequestRejections,
      Effect.withSpan("test.request"),
      Effect.provideService(Tracer.Tracer, tracer)
    );

    const attributes = spans[0]?.attributes;
    expect(attributes?.get("error.type")).toBe("HttpApiSchemaError");
    expect(attributes?.get("feeblo.request.rejection.kind")).toBe("Payload");
    expect(issuesOf(attributes)).toContain("$: InvalidType");
  })
);

it.effect("caps the issue list and marks the rest as truncated", () =>
  Effect.gen(function* () {
    const issues = yield* recordOnSpan(yield* manyIssuesRejection(12));

    expect(issues.endsWith("+more")).toBe(true);
    expect(issues.split(", ")).toHaveLength(11);
  })
);

it.effect("deduplicates a finding the issue tree repeats", () =>
  Effect.gen(function* () {
    const issues = yield* recordOnSpan(yield* repeatedFindingRejection());

    expect(issues).toBe("$.a: Filter");
  })
);
