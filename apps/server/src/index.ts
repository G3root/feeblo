import { createServer } from "node:http";
import {
  NodeFileSystem,
  NodeHttpServer,
  NodePath,
  NodeRuntime,
} from "@effect/platform-node";
import { initAuthHandler } from "@feeblo/auth/server";
import { Database } from "@feeblo/db";
import { Api } from "@feeblo/domain/http/api";
import { HttpRoute } from "@feeblo/domain/http/router";
import { RpcRoute } from "@feeblo/domain/rpc-router";
import { S3UploadServiceLive } from "@feeblo/domain/services/s3";
import {
  Auth,
  HttpApiAuthMiddlewareLive,
} from "@feeblo/domain/session-middleware";
import { Config, Effect, Layer } from "effect";
import {
  HttpEffect,
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiScalar } from "effect/unstable/httpapi";
import { ServerConfig } from "./config";

const ServiceLayers = Database.Database.Client;
const AuthLayer = Layer.effect(Auth, initAuthHandler());

const BetterAuthApp = Effect.gen(function* () {
  const auth = yield* Auth;
  return yield* HttpEffect.fromWebHandler((request) =>
    Promise.resolve(auth.handler(request))
  );
});

const BetterAuthRouterLive = HttpRouter.use((router) =>
  router.add("*", "/api/auth/*", (request) =>
    Effect.provideService(
      BetterAuthApp,
      HttpServerRequest.HttpServerRequest,
      request
    )
  )
);

const DocsRoute = HttpApiScalar.layer(Api, {
  path: "/docs",
});

const CorsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { appUrl, apiUrl } = yield* ServerConfig;

    const appParsed = new URL(appUrl);
    const apiParsed = new URL(apiUrl);
    const appOrigin = appParsed.origin;

    return HttpRouter.middleware(
      HttpMiddleware.cors({
        allowedOrigins: (origin: string) => {
          if (origin === appOrigin || origin === apiParsed.origin) {
            return true;
          }

          try {
            const { hostname, port } = new URL(origin);
            return (
              hostname.endsWith(`.${appParsed.hostname}`) &&
              port === appParsed.port
            );
          } catch {
            return false;
          }
        },
        allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
      })
    ).layer;
  }).pipe(Effect.provide(ServerConfig.layer))
);

const HealthRouter = HttpRouter.use((router) =>
  router.add("GET", "/health", HttpServerResponse.text("OK"))
);

const AllRoutes = Layer.mergeAll(
  HealthRouter,
  RpcRoute,
  HttpRoute,
  BetterAuthRouterLive,
  DocsRoute,
  CorsLayer
);

const ServerLayer = HttpRouter.serve(AllRoutes, {
  routerConfig: {
    maxParamLength: 500,
  },
}).pipe(
  Layer.provide(HttpApiAuthMiddlewareLive),
  Layer.provide(AuthLayer),
  Layer.provide(ServiceLayers),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
  Layer.provide(S3UploadServiceLive),
  Layer.provide(
    NodeHttpServer.layerConfig(
      createServer,
      Config.all({
        port: Config.number("SERVER_PORT").pipe(Config.withDefault(3000)),
      })
    )
  )
);

NodeRuntime.runMain(Layer.launch(ServerLayer));
