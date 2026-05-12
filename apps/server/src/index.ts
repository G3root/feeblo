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
import { Auth } from "@feeblo/domain/session-middleware";
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

const HealthRouter = HttpRouter.use((router) =>
  router.add("GET", "/health", HttpServerResponse.text("OK"))
);

const RootRouter = HttpRouter.use((router) =>
  router.add("GET", "/", HttpServerResponse.text("Hello world"))
);

const program = Effect.gen(function* () {
  const config = yield* ServerConfig;

  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }

    try {
      const originHost = new URL(origin).hostname;
      const appHost = new URL(config.appUrl).hostname;
      const apiHost = new URL(config.apiUrl).hostname;

      if (originHost === apiHost) {
        return true;
      }
      if (originHost === appHost) {
        return true;
      }
      if (originHost.endsWith(`.${appHost}`)) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  };

  const AllRoutes = Layer.mergeAll(
    RootRouter,
    HealthRouter,
    RpcRoute,
    HttpRoute,
    BetterAuthRouterLive,
    DocsRoute
  ).pipe(
    Layer.provide(
      HttpRouter.middleware(
        HttpMiddleware.cors({
          allowedOrigins: isAllowedOrigin,
          allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
          credentials: true,
        }),
        { global: true }
      )
    )
  );

  const server = HttpRouter.serve(AllRoutes, {
    routerConfig: {
      maxParamLength: 500,
    },
  }).pipe(
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
    )
  );

  return yield* Layer.launch(server);
});

program.pipe(Effect.provide(ServerConfig.layer), NodeRuntime.runMain);
