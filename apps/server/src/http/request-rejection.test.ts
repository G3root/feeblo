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
    expect(
      String(attributes?.get("feeblo.request.rejection.issues"))
    ).toContain("$: InvalidType");
  })
);
