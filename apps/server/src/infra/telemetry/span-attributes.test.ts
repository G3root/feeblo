import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";

import {
  allowedSpans,
  httpSpanAttributeAllowlist,
  rootSpanNoise,
  routeTemplates,
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

const withTracer = (
  tracer: Tracer.Tracer,
  options?: {
    readonly sampleRate?: number | undefined;
    readonly dropRootSpans?: ReadonlySet<string> | undefined;
  }
) => Effect.provideService(Tracer.Tracer, allowedSpans(tracer, options));

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
        withTracer(tracer, { sampleRate: 1 })
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
        withTracer(dropped.tracer, { sampleRate: 0 })
      );
      expect(dropped.spans[0]?.sampled).toBe(false);

      const kept = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan("root"),
        withTracer(kept.tracer, { sampleRate: 1 })
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
        withTracer(tracer, { sampleRate: 1 })
      );
      expect(spans.map((span) => span.sampled)).toEqual([false, false]);
    })
  );

  it.effect("drops a parentless span named as library noise", () =>
    Effect.gen(function* () {
      for (const name of rootSpanNoise) {
        const { spans, tracer } = recordingTracer();
        yield* Effect.void.pipe(
          Effect.withSpan(name),
          withTracer(tracer, { sampleRate: 1 })
        );
        expect(spans[0]?.sampled).toBe(false);
      }
    })
  );

  it.effect("keeps a SQL span that hangs from a request", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan("sql.execute"),
        Effect.withSpan("http.server.request"),
        withTracer(tracer, { sampleRate: 1 })
      );
      expect(spans.map((span) => span.sampled)).toEqual([true, true]);
    })
  );

  it.effect("replaces a matched path with the router's route template", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      // The router records the route after the request middleware.
      yield* Effect.annotateCurrentSpan(
        "http.route",
        "/email-provider/ses/:token"
      ).pipe(
        Effect.withSpan("http.server.request", {
          attributes: { "url.path": "/email-provider/ses/secret-token" },
        }),
        withTracer(tracer, { sampleRate: 1 })
      );

      const attributes = spans[0]?.attributes;
      expect(attributes?.get("url.path")).toBe("/email-provider/ses/:token");
      expect(attributes?.get("http.route")).toBe("/email-provider/ses/:token");
    })
  );

  it.effect("records the route template when it arrives before the path", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      yield* Effect.annotateCurrentSpan("url.path", "/posts/lg_secret").pipe(
        Effect.withSpan("http.server.request", {
          attributes: { "http.route": "/posts/:postId" },
        }),
        withTracer(tracer, { sampleRate: 1 })
      );

      expect(spans[0]?.attributes.get("url.path")).toBe("/posts/:postId");
    })
  );

  it("names a fixed endpoint served under a wildcard route", () => {
    const templates = routeTemplates([
      "/api/auth/sign-in",
      "/api/auth/callback/:provider",
    ]);

    expect(templates.match("/api/auth/sign-in")).toBe("/api/auth/sign-in");
    expect(templates.match("/api/auth/callback/github")).toBe(
      "/api/auth/callback/:provider"
    );
    expect(templates.match("/api/auth/unknown")).toBeUndefined();
  });

  it("prefers a fixed segment over a parameter from left to right", () => {
    const templates = routeTemplates([
      "/api/auth/:provider/callback",
      "/api/auth/callback/:provider",
    ]);

    expect(templates.match("/api/auth/callback/callback")).toBe(
      "/api/auth/callback/:provider"
    );
  });

  it.effect("drops only the configured root names", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan("custom.noise"),
        withTracer(tracer, {
          sampleRate: 1,
          dropRootSpans: new Set(["custom.noise"]),
        })
      );
      yield* Effect.void.pipe(
        Effect.withSpan("sql.execute"),
        withTracer(tracer, {
          sampleRate: 1,
          dropRootSpans: new Set(["custom.noise"]),
        })
      );
      expect(spans.map((span) => span.sampled)).toEqual([false, true]);
    })
  );
});
