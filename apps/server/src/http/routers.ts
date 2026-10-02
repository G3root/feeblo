import { AUTH_CLIENT_IP_HEADER } from "@feeblo/auth/auth-client-ip-header";
import { Database } from "@feeblo/db";
import { ClientIp } from "@feeblo/domain/client-ip";
import { handleOgImage } from "@feeblo/domain/og-image/handler";
import { OgImageService } from "@feeblo/domain/og-image/service";
import { PublicApi } from "@feeblo/domain/public-api/api-contract";
import { Auth } from "@feeblo/domain/session-middleware";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpApiScalar from "effect/http-api/HttpApiScalar";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { handleBetterAuthRequest } from "./body-limit";

export const BetterAuthRouterLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    return yield* router.add("*", "/api/auth/*", (request) =>
      Effect.gen(function* () {
        const clientIp = yield* ClientIp;
        const authApp = HttpEffect.fromWebHandler((webRequest) => {
          // Overwrite this internal header at the HTTP boundary. Better Auth
          // cannot access the peer socket, so this is the only client-IP value
          // it may use for SSO attempt rate limiting.
          const headers = new Headers(webRequest.headers);
          headers.set(
            AUTH_CLIENT_IP_HEADER,
            clientIp._tag === "ClientIpAddress" ? clientIp.address : "unknown"
          );
          return handleBetterAuthRequest({
            handler: auth.handler,
            headers,
            request: webRequest,
          });
        });

        return yield* Effect.provideService(
          authApp,
          HttpServerRequest.HttpServerRequest,
          request
        );
      }).pipe(Effect.orDie)
    );
  })
);

export const OgImageRouterLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const ogImageService = yield* OgImageService;
    return yield* router.add("GET", "/og-image", (request) =>
      handleOgImage(request).pipe(
        Effect.provideService(OgImageService, ogImageService)
      )
    );
  })
).pipe(
  Layer.provide(OgImageService.layer),
  Layer.provide(Database.DatabaseContextLive),
  Layer.orDie
);

/**
 * The Public API's reference page, mounted wherever `PublicApiRoute` is.
 *
 * The same `PublicApi` value produces both this page and the document
 * `PublicApiRoute` serves at `/api/v1/openapi.json`, so the reference cannot
 * describe a contract the route does not serve. Scalar adds a plain `GET`
 * route of its own, so the API-key middleware never runs on it: the reference
 * is readable without a key, which is what makes it self-serve.
 */
export const PublicApiDocsRoute = HttpApiScalar.layer(PublicApi, {
  path: "/api/v1/docs",
});

export const HealthRouter: Layer.Layer<never, never, HttpRouter.HttpRouter> =
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      // Resolve APP_RELEASE once during layer construction so the /health
      // handler does not re-read configuration on every request.
      const release = yield* Config.String("APP_RELEASE").pipe(
        Config.withDefault("dev"),
        Effect.orDie
      );
      return yield* router.add(
        "GET",
        "/health",
        HttpServerResponse.json({ status: "ok", release }).pipe(Effect.orDie)
      );
    })
  );

export const RootRouter = HttpRouter.use((router) =>
  router.add("GET", "/", HttpServerResponse.text("Hello world"))
);
