import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";

import { browserBatch, makeBrowserTelemetryRouter } from "./browser-telemetry";

interface Sent {
  readonly url: string;
  readonly body: string;
}

const collect = (sent: Array<Sent>): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const body = request.body;
        sent.push({
          url: request.url,
          // The relay sends an `HttpBody.text`, which keeps its source text.
          body: body._tag === "Uint8Array" ? (body.text ?? "") : "",
        });
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, { status: 200 })
        );
      })
    )
  );

const tracingEnv = {
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.test",
};

const app = (
  env: Record<string, string>,
  sent: Array<Sent> = []
): Layer.Layer<never, never, HttpRouter.HttpRouter> =>
  makeBrowserTelemetryRouter(
    { service: "feeblo-server", environment: "test" },
    collect(sent)
  ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))));

const post = (
  handler: (request: Request) => Promise<globalThis.Response>,
  path: string,
  body: string,
  contentType = "application/json"
) =>
  handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    })
  );

/**
 * The browser relay is unauthenticated by design, so these tests pin the
 * boundary instead: only the two known signals forward, the body must be
 * JSON and bounded, the forwarded identity is the server's, and a deployment
 * without OTLP accepts-and-discards rather than failing every page load.
 */
describe("browser telemetry relay", () => {
  it.live("forwards a trace batch to the configured destination", () => {
    const sent: Array<Sent> = [];
    return Effect.gen(function* () {
      const { handler, dispose } = HttpRouter.toWebHandler(
        app(tracingEnv, sent),
        { disableLogger: true }
      );
      const response = yield* Effect.promise(() =>
        post(handler, "/api/telemetry/traces", '{"resourceSpans":[]}')
      );
      yield* Effect.promise(() => dispose());
      expect(response.status).toBe(202);
      expect(sent.map(({ url }) => url)).toEqual([
        "http://collector.test/v1/traces",
      ]);
      expect(sent[0]?.body).toContain('"service.name"');
      expect(sent[0]?.body).toContain('"feeblo-server-web"');
    });
  });

  it.live("replaces the caller's identity before forwarding", () => {
    const sent: Array<Sent> = [];
    const forged = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "feeblo-server" } },
            ],
          },
          scopeSpans: [{ spans: [{ name: "post.delete" }] }],
        },
      ],
    });
    return Effect.gen(function* () {
      const { handler, dispose } = HttpRouter.toWebHandler(
        app(tracingEnv, sent),
        { disableLogger: true }
      );
      const response = yield* Effect.promise(() =>
        post(handler, "/api/telemetry/traces", forged)
      );
      yield* Effect.promise(() => dispose());
      expect(response.status).toBe(202);
      expect(sent[0]?.body).toContain('"stringValue":"feeblo-server-web"');
      expect(sent[0]?.body).not.toContain('"stringValue":"feeblo-server"');
      expect(sent[0]?.body).toContain('"name":"post.delete"');
    });
  });

  it.live("rejects a non-JSON body before forwarding", () => {
    const sent: Array<Sent> = [];
    return Effect.gen(function* () {
      const { handler, dispose } = HttpRouter.toWebHandler(
        app(tracingEnv, sent),
        { disableLogger: true }
      );
      const response = yield* Effect.promise(() =>
        post(handler, "/api/telemetry/traces", "not json", "text/plain")
      );
      yield* Effect.promise(() => dispose());
      expect(response.status).toBe(415);
      expect(sent).toEqual([]);
    });
  });

  it.live("refuses a body that is not an OTLP batch for the signal", () => {
    const sent: Array<Sent> = [];
    return Effect.gen(function* () {
      const { handler, dispose } = HttpRouter.toWebHandler(
        app(tracingEnv, sent),
        { disableLogger: true }
      );
      const response = yield* Effect.promise(() =>
        post(
          handler,
          "/api/telemetry/traces",
          JSON.stringify({ resourceLogs: [] })
        )
      );
      yield* Effect.promise(() => dispose());
      expect(response.status).toBe(400);
      expect(sent).toEqual([]);
    });
  });

  it.live("accepts and discards a batch when OTLP is unconfigured", () => {
    const sent: Array<Sent> = [];
    return Effect.gen(function* () {
      const { handler, dispose } = HttpRouter.toWebHandler(app({}, sent), {
        disableLogger: true,
      });
      const response = yield* Effect.promise(() =>
        post(handler, "/api/telemetry/traces", '{"resourceSpans":[]}')
      );
      yield* Effect.promise(() => dispose());
      expect(response.status).toBe(202);
      expect(sent).toEqual([]);
    });
  });

  it.live("answers 404 for an unknown relay path", () => {
    const sent: Array<Sent> = [];
    return Effect.gen(function* () {
      const { handler, dispose } = HttpRouter.toWebHandler(
        app(tracingEnv, sent),
        { disableLogger: true }
      );
      const response = yield* Effect.promise(() =>
        post(handler, "/api/telemetry/metrics", "{}")
      );
      yield* Effect.promise(() => dispose());
      expect(response.status).toBe(404);
      expect(sent).toEqual([]);
    });
  });

  it.live("caps an oversized batch", () => {
    const sent: Array<Sent> = [];
    return Effect.gen(function* () {
      const { handler, dispose } = HttpRouter.toWebHandler(
        app(tracingEnv, sent),
        { disableLogger: true }
      );
      const response = yield* Effect.promise(() =>
        post(handler, "/api/telemetry/traces", `"${"x".repeat(300 * 1024)}"`)
      );
      yield* Effect.promise(() => dispose());
      expect(response.status).toBe(413);
      expect(sent).toEqual([]);
    });
  });
});

/**
 * The relay is public, so the resource identity is the server's, not the
 * caller's. These cases pin that a forged `service.name` is replaced while the
 * records the caller actually sent survive.
 */
describe("browserBatch", () => {
  const identity = {
    service: "feeblo-server-web",
    version: "abc123",
    environment: "production",
  };

  it("replaces a forged service identity on spans", () => {
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "feeblo-server" } },
              { key: "attacker.attribute", value: { stringValue: "yes" } },
            ],
          },
          scopeSpans: [
            { scope: { name: "forged" }, spans: [{ name: "post.delete" }] },
          ],
        },
      ],
    });
    const rewritten = browserBatch("traces", body, identity);
    expect(rewritten).toBeDefined();
    expect(rewritten).toContain('"stringValue":"feeblo-server-web"');
    expect(rewritten).not.toContain('"stringValue":"feeblo-server"');
    expect(rewritten).not.toContain("attacker.attribute");
    expect(rewritten).toContain('"name":"post.delete"');
  });

  it("replaces a forged service identity on logs", () => {
    const body = JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "feeblo-server" } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: "forged" },
              logRecords: [{ body: { stringValue: "x" } }],
            },
          ],
        },
      ],
    });
    const rewritten = browserBatch("logs", body, identity);
    expect(rewritten).toBeDefined();
    expect(rewritten).toContain('"stringValue":"feeblo-server-web"');
    expect(rewritten).not.toContain('"stringValue":"feeblo-server"');
  });

  it("refuses a body that is not an OTLP batch for the signal", () => {
    expect(browserBatch("traces", "{}", identity)).toBeUndefined();
    expect(browserBatch("logs", "not json", identity)).toBeUndefined();
    expect(
      browserBatch("traces", JSON.stringify({ resourceLogs: [] }), identity)
    ).toBeUndefined();
  });
});
