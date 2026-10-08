import { describe, expect, it } from "@effect/vitest";
import { rpcSpanPrefix } from "@feeblo/domain/rpc-router";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

import { rpcMethodFromSpanName, rpcSpans } from "./rpc-spans";
import { allowedSpans } from "./span-attributes";

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

/** The real chain: RPC labelling inside the attribute filter and sampler. */
const withTracer = (tracer: Tracer.Tracer, spanPrefix = rpcSpanPrefix) =>
  Effect.provideService(
    Tracer.Tracer,
    allowedSpans(rpcSpans(tracer, { spanPrefix }), { sampleRate: 1 })
  );

describe("rpcMethodFromSpanName", () => {
  it("reads the method from a prefixed span name", () => {
    expect(
      rpcMethodFromSpanName(`${rpcSpanPrefix}.PostCreate`, rpcSpanPrefix)
    ).toBe("PostCreate");
  });

  it("ignores every other span", () => {
    expect(rpcMethodFromSpanName("rpc.PostCreate", rpcSpanPrefix)).toBe(
      undefined
    );
    expect(rpcMethodFromSpanName("http.server POST", rpcSpanPrefix)).toBe(
      undefined
    );
    expect(rpcMethodFromSpanName(rpcSpanPrefix, rpcSpanPrefix)).toBe(undefined);
  });
});

describe("rpcSpans", () => {
  it.effect("labels an RPC span and its parent HTTP span", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan(`${rpcSpanPrefix}.WorkspaceCreationStateGet`),
        Effect.withSpan("http.server POST"),
        withTracer(tracer)
      );

      const httpSpan = spans[0];
      const rpcSpan = spans[1];
      expect(rpcSpan?.name).toBe(`${rpcSpanPrefix}.WorkspaceCreationStateGet`);
      expect(rpcSpan?.attributes.get("rpc.system.name")).toBe("effect");
      expect(rpcSpan?.attributes.get("rpc.method")).toBe(
        "WorkspaceCreationStateGet"
      );
      // The parent is the operation a backend lists, so it carries the method.
      expect(httpSpan?.attributes.get("rpc.method")).toBe(
        "WorkspaceCreationStateGet"
      );
    })
  );

  it.effect("leaves a non-RPC span untouched", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan("feeblo.some.operation"),
        withTracer(tracer)
      );

      expect(spans[0]?.attributes.get("rpc.method")).toBeUndefined();
      expect(spans[0]?.attributes.get("rpc.system.name")).toBeUndefined();
    })
  );

  it.effect("still labels an RPC span whose parent is external", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      yield* Effect.void.pipe(
        Effect.withSpan(`${rpcSpanPrefix}.Ping`, {
          parent: Tracer.externalSpan({
            spanId: "1111111111111111",
            traceId: "22222222222222222222222222222222",
            sampled: true,
          }),
        }),
        withTracer(tracer)
      );

      expect(spans[0]?.attributes.get("rpc.method")).toBe("Ping");
    })
  );

  it.effect("labels the HTTP link when the client owns the trace context", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recordingTracer();
      const httpSpan = new Tracer.NativeSpan({
        annotations: Context.empty(),
        kind: "internal",
        links: [],
        name: "http.server POST",
        parent: Option.none(),
        sampled: true,
        startTime: 0n,
      });
      yield* Effect.void.pipe(
        Effect.withSpan(`${rpcSpanPrefix}.Ping`, {
          parent: Tracer.externalSpan({
            spanId: "1111111111111111",
            traceId: "22222222222222222222222222222222",
            sampled: true,
          }),
          links: [{ span: httpSpan, attributes: {} }],
        }),
        withTracer(tracer)
      );

      expect(spans.at(-1)?.attributes.get("rpc.method")).toBe("Ping");
      expect(httpSpan.attributes.get("rpc.method")).toBe("Ping");
    })
  );
});
