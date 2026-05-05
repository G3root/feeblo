import { createServer } from "node:http";
import {
  HttpApiScalar,
  HttpApp,
  HttpLayerRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import {
  NodeFileSystem,
  NodeHttpServer,
  NodePath,
  NodeRuntime,
} from "@effect/platform-node";
import { initAuthHandler } from "@feeblo/auth/server";
import { DB } from "@feeblo/db";
import { Api } from "@feeblo/domain/http/api";
import { HttpRoute } from "@feeblo/domain/http/router";
import { RpcRoute } from "@feeblo/domain/rpc-router";
import {
  Auth,
  HttpApiAuthMiddlewareLive,
} from "@feeblo/domain/session-middleware";
import { Config, Effect, Layer } from "effect";
import { ServerConfig } from "./config";

const ServiceLayers = DB.Client;
const AuthLayer = Layer.effect(Auth, initAuthHandler());

const BetterAuthApp = Effect.gen(function* () {
  const auth = yield* Auth;
  return yield* HttpApp.fromWebHandler(auth.handler);
});

const BetterAuthRouterLive = HttpLayerRouter.use((router) =>
  router.add("*", "/api/auth/*", (request) =>
    Effect.provideService(
      BetterAuthApp,
      HttpServerRequest.HttpServerRequest,
      request
    )
  )
);

const DocsRoute = HttpApiScalar.layerHttpLayerRouter({
  api: Api,
  path: "/docs",
});

const CorsLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { appUrl, apiUrl } = yield* ServerConfig;

    const appParsed = new URL(appUrl);
    const apiParsed = new URL(apiUrl);
    const appOrigin = appParsed.origin;
    const apiOrigin = apiParsed.origin;

    return HttpLayerRouter.cors({
      allowedOrigins: (origin: string) => {
        if (origin === appOrigin || origin === apiOrigin) {
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
    });
  }).pipe(Effect.provide(ServerConfig.layer))
);

const HealthRouter = HttpLayerRouter.use((router) =>
  router.add("GET", "/health", HttpServerResponse.text("OK"))
);

const AllRoutes = Layer.mergeAll(
  HealthRouter,
  RpcRoute,
  HttpRoute,
  BetterAuthRouterLive,
  DocsRoute
).pipe(Layer.provide(CorsLayer));

HttpLayerRouter.serve(AllRoutes, {
  routerConfig: {
    maxParamLength: 500,
  },
}).pipe(
  Layer.provide(HttpApiAuthMiddlewareLive),
  Layer.provide(AuthLayer),
  Layer.provide(ServiceLayers),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
  Layer.provide(
    NodeHttpServer.layerConfig(
      createServer,
      Config.all({
        port: Config.number("SERVER_PORT").pipe(Config.withDefault(3000)),
      })
    )
  ),
  Layer.launch,
  NodeRuntime.runMain
);
