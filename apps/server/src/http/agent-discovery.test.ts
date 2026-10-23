import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";

import { makeAgentDiscoveryRouter } from "./agent-discovery";

/**
 * The discovery documents are the only part of the API that a robot reads
 * before it has a credential. A wrong absolute URL or a missing `Link` header
 * here sends every agent to a dead contract, so each document is checked for
 * the route it advertises and the origin it was requested from, not just for a
 * 200.
 */
const withApp = <A, E, R>(
  run: (app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
    readonly dispose: () => Promise<void>;
  }) => Effect.Effect<A, E, R>,
  apiUrl = "https://api.feeblo.com"
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(makeAgentDiscoveryRouter(apiUrl), {
        disableLogger: true,
      })
    ),
    run,
    (app) => Effect.promise(() => app.dispose())
  );

const get = (
  app: {
    readonly handler: (request: Request) => Promise<globalThis.Response>;
  },
  path: string,
  headers: Record<string, string> = {}
) =>
  Effect.promise(() =>
    app.handler(
      new Request(`https://api.feeblo.com${path}`, {
        headers,
      })
    )
  );

const expectOk = (response: globalThis.Response, contentType: string) => {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain(contentType);
};

it.live("serves the API landing page as Markdown with discovery links", () =>
  withApp((app) =>
    Effect.gen(function* () {
      const response = yield* get(app, "/");
      expectOk(response, "text/markdown");
      const body = yield* Effect.promise(() => response.text());

      expect(body).toContain("# Feeblo Public API");
      expect(body).toContain("https://api.feeblo.com/api/v1");
      expect(body).toContain("https://api.feeblo.com/mcp");
      expect(body).toContain("x-api-key");

      const link = response.headers.get("link") ?? "";
      expect(link).toContain('</.well-known/api-catalog>; rel="api-catalog"');
      expect(link).toContain('</api/v1/openapi.json>; rel="service-desc"');
      expect(link).toContain('</auth.md>; rel="describedby"');
      // The profile parameter belongs in the response body's content type, not
      // nested inside a quoted `type` Link parameter.
      expect(link).not.toContain("profile=");
    })
  )
);

it.live("serves /llms.txt from the same source as the root page", () =>
  withApp((app) =>
    Effect.gen(function* () {
      const root = yield* get(app, "/");
      const llms = yield* get(app, "/llms.txt");
      const rootBody = yield* Effect.promise(() => root.text());
      const llmsBody = yield* Effect.promise(() => llms.text());

      expectOk(llms, "text/plain");
      expect(llmsBody).toBe(rootBody);
    })
  )
);

it.live("serves the auth guide the API contract points at", () =>
  withApp((app) =>
    Effect.gen(function* () {
      const response = yield* get(app, "/auth.md");
      expectOk(response, "text/markdown");
      const body = yield* Effect.promise(() => response.text());

      expect(body).toContain("Settings → Developers");
      expect(body).toContain("x-api-key");
      expect(body).toContain("https://api.feeblo.com/mcp");
      expect(body).toContain("PLAN_REQUIRES_UPGRADE");
    })
  )
);

it.live("serves an RFC 9727 API catalog for the HTTP and MCP surfaces", () =>
  withApp((app) =>
    Effect.gen(function* () {
      const response = yield* get(app, "/.well-known/api-catalog");
      expectOk(response, "application/linkset+json");
      expect(response.headers.get("content-type")).toContain(
        "https://www.rfc-editor.org/info/rfc9727"
      );
      // SAFETY: The route serializes the `apiCatalog` value this module
      // builds; the assertion below is its declared shape.
      const parsed = JSON.parse(
        yield* Effect.promise(() => response.text())
      ) as {
        linkset: ReadonlyArray<{
          anchor: string;
          "service-desc": ReadonlyArray<{ href: string }>;
        }>;
      };

      const api = parsed.linkset.find(
        (entry) => entry.anchor === "https://api.feeblo.com/api/v1"
      );
      expect(api?.["service-desc"]).toContainEqual({
        href: "https://api.feeblo.com/api/v1/openapi.json",
        type: "application/json",
      });

      const mcp = parsed.linkset.find(
        (entry) => entry.anchor === "https://api.feeblo.com/mcp"
      );
      expect(mcp?.["service-desc"]).toContainEqual({
        href: "https://api.feeblo.com/.well-known/mcp.json",
        type: "application/json",
      });
    })
  )
);

it.live("serves an MCP server card that states the key requirement", () =>
  withApp((app) =>
    Effect.gen(function* () {
      const response = yield* get(app, "/.well-known/mcp.json");
      expectOk(response, "application/json");
      // SAFETY: The route serializes the `mcpServerCard` value this module
      // builds; the assertion below is its declared shape.
      const parsed = JSON.parse(
        yield* Effect.promise(() => response.text())
      ) as {
        servers: ReadonlyArray<{
          url: string;
          transport: string;
          authentication: { required: boolean; scheme: string };
        }>;
      };

      expect(parsed.servers).toHaveLength(1);
      expect(parsed.servers[0]).toMatchObject({
        transport: "streamable-http",
        url: "https://api.feeblo.com/mcp",
        authentication: { required: true, scheme: "x-api-key" },
      });
    })
  )
);

it.live("advertises the origin the request arrived on", () =>
  withApp((app) =>
    Effect.gen(function* () {
      const response = yield* get(app, "/auth.md", {
        "x-forwarded-host": "feedback.example.test",
        "x-forwarded-proto": "https",
      });
      const body = yield* Effect.promise(() => response.text());

      expect(body).toContain("https://feedback.example.test/api/v1");
      expect(body).toContain("https://feedback.example.test/mcp");
      expect(body).not.toContain("https://api.feeblo.com/mcp");
    })
  )
);

it.live("uses the configured API URL's scheme when no proxy supplies one", () =>
  withApp(
    (app) =>
      Effect.gen(function* () {
        const response = yield* get(app, "/auth.md", {
          "x-forwarded-host": "192.168.1.20:8080",
        });
        const body = yield* Effect.promise(() => response.text());

        expect(body).toContain("http://192.168.1.20:8080/api/v1");
        expect(body).not.toContain("https://192.168.1.20:8080");
      }),
    "http://192.168.1.20:8080"
  )
);
