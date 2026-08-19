import { AUTH_CLIENT_IP_HEADER } from "@feeblo/auth/auth-client-ip-header";
import { Database } from "@feeblo/db";
import { ClientIp } from "@feeblo/domain/client-ip";
import { Api } from "@feeblo/domain/http/api";
import { handleOgImage } from "@feeblo/domain/og-image/handler";
import { OgImageService } from "@feeblo/domain/og-image/service";
import { Auth } from "@feeblo/domain/session-middleware";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiScalar from "effect/unstable/httpapi/HttpApiScalar";

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

export const DocsRoute = HttpApiScalar.layer(Api, {
  path: "/docs",
});

export const HealthRouter: Layer.Layer<never, never, HttpRouter.HttpRouter> =
  HttpRouter.use((router) =>
    router.add(
      "GET",
      "/health",
      Effect.gen(function* () {
        const release = yield* Config.string("APP_RELEASE").pipe(
          Config.withDefault("dev")
        );
        return yield* HttpServerResponse.json({ status: "ok", release });
      }).pipe(Effect.orDie)
    )
  );

export const RootRouter = HttpRouter.use((router) =>
  router.add("GET", "/", HttpServerResponse.text("Hello world"))
);
