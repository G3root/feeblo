import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";

import {
  allowedSpans,
  httpSpanAttributeAllowlist,
  spanAttributeAllowed,
} from "./span-attributes";

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

const withTracer = (tracer: Tracer.Tracer, sampleRate?: number) =>
  Effect.provideService(Tracer.Tracer, allowedSpans(tracer, { sampleRate }));

describe("spanAttributeAllowed", () => {
  it("lets product attributes through", () => {
    expect(spanAttributeAllowed("feeblo.organization.id")).toBe(true);
    expect(spanAttributeAllowed("post.id")).toBe(true);
  });

  it("keeps the fixed HTTP allowlist", () => {
    for (const key of httpSpanAttributeAllowlist) {
      expect(spanAttributeAllowed(key)).toBe(true);
    }
  });

  it("drops every other HTTP attribute", () => {
    expect(spanAttributeAllowed("url.full")).toBe(false);
    expect(spanAttributeAllowed("url.query")).toBe(false);
    expect(spanAttributeAllowed("http.request.header.authorization")).toBe(
      false
    );
    expect(spanAttributeAllowed("http.response.header.set-cookie")).toBe(false);
  });
});

describe("allowedSpans", () => {
  it.effect("drops URL and header attributes from a span", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan("http.server.request", {
          attributes: {
            "feeblo.organization.id": "org_1",
            "http.request.header.authorization": "Bearer secret",
            "http.request.method": "GET",
            "url.full": "https://example.test/x?token=secret",
            "url.path": "/x",
            "url.query": "token=secret",
          },
        }),
        withTracer(tracer, 1)
      );

      const attributes = spans[0]?.attributes;
      expect(attributes?.get("feeblo.organization.id")).toBe("org_1");
      expect(attributes?.get("http.request.method")).toBe("GET");
      expect(attributes?.get("url.path")).toBe("/x");
      expect(attributes?.get("url.full")).toBeUndefined();
      expect(attributes?.get("url.query")).toBeUndefined();
      expect(
        attributes?.get("http.request.header.authorization")
      ).toBeUndefined();
    })
  );

  it.effect("samples a root span at the configured rate", () =>
    Effect.gen(function* () {
      const dropped = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan("root"),
        withTracer(dropped.tracer, 0)
      );
      expect(dropped.spans[0]?.sampled).toBe(false);

      const kept = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan("root"),
        withTracer(kept.tracer, 1)
      );
      expect(kept.spans[0]?.sampled).toBe(true);
    })
  );

  it.effect("keeps a child's sampling decision with its root", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan("child"),
        Effect.withSpan("root", { sampled: false }),
        withTracer(tracer, 1)
      );
      expect(spans.map((span) => span.sampled)).toEqual([false, false]);
    })
  );
});
