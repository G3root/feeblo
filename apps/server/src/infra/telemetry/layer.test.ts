import { createServer } from "node:http";

import { expect, it } from "@effect/vitest";
import { isString } from "@feeblo/utils/runtime-kind";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";

import { telemetryLayer } from "./layer";

/** A loopback OTLP collector that records the bodies it receives. */
const withCollector = <A, E, R>(
  run: (url: string, requests: Array<string>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.callback<{
      readonly url: string;
      readonly requests: Array<string>;
      readonly close: Effect.Effect<void>;
    }>((resume) => {
      const requests: Array<string> = [];
      const server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        request.on("end", () => {
          requests.push(body);
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || isString(address)) {
          resume(Effect.die(new Error("Expected a TCP address")));
          return;
        }
        resume(
          Effect.succeed({
            url: `http://127.0.0.1:${address.port}`,
            requests,
            close: Effect.callback<void>((done) => {
              server.closeAllConnections();
              server.close(() => done(Effect.void));
            }),
          })
        );
      });
    }),
    ({ requests, url }) => run(url, requests),
    ({ close }) => close
  );

it.live("exports a span to the configured OTLP endpoint", () =>
  withCollector((url, requests) =>
    Effect.gen(function* () {
      const layer = telemetryLayer({
        dropRootSpans: true,
        environment: "test",
        service: "feeblo-test",
        traces: { url: `${url}/v1/traces` },
        tracesSampleRate: 1,
        version: "test",
      });
      // Build the layer in the test's own scope so closing it flushes the
      // exporter before the collector is asserted.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(layer);
          yield* Effect.void.pipe(
            Effect.withSpan("feeblo.test.span", {
              attributes: {
                "url.path": "/posts",
                "url.query": "token=secret",
              },
            }),
            Effect.provideService(
              Tracer.Tracer,
              Context.get(context, Tracer.Tracer)
            )
          );
          yield* Effect.sleep("100 millis");
        })
      );
      // Scope close flushes the batch; give the loopback POST time to land.
      yield* Effect.sleep("250 millis");

      const payload = requests.join("");
      expect(payload).toContain("feeblo.test.span");
      expect(payload).toContain("/posts");
      expect(payload).not.toContain("secret");
    })
  )
);
