import {
  HttpApp,
  HttpLayerRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { initAuthHandler } from "@feeblo/auth";
import { DB } from "@feeblo/db";
import { RpcRoute } from "@feeblo/domain/rpc-router";
import { Auth } from "@feeblo/domain/session-middleware";
import { Config, Effect, Layer } from "effect";

const ServiceLayers = DB.Client;
const AuthLayer = Layer.effect(Auth, initAuthHandler());

const BetterAuthApp = Effect.flatMap(initAuthHandler(), (auth) =>
  HttpApp.fromWebHandler(auth.handler)
);

const BetterAuthRouterLive = HttpLayerRouter.use((router) =>
  router.add("*", "/api/auth/*", (request) =>
    Effect.provideService(
      BetterAuthApp,
      HttpServerRequest.HttpServerRequest,
      request
    )
  )
);

const CorsLayer = Layer.unwrapEffect(
  Config.all({
    appUrl: Config.string("VITE_APP_URL"),
    apiUrl: Config.string("VITE_API_URL"),
  }).pipe(
    Effect.map(({ appUrl, apiUrl }) => {
      const appParsed = new URL(appUrl);
      const apiParsed = new URL(apiUrl);
      const appOrigin = appParsed.origin;
      const apiOrigin = apiParsed.origin;

      const isAllowedOrigin = (origin: string) => {
        if (origin === appOrigin || origin === apiOrigin) { return true; }
        try {
          const { hostname, port } = new URL(origin);
          return (
            hostname.endsWith(`.${appParsed.hostname}`) &&
            port === appParsed.port
          );
        } catch {
          return false;
        }
      };

      return HttpLayerRouter.cors({
        allowedOrigins: isAllowedOrigin,
        allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
      });
    })
  )
);

const HealthRouter = HttpLayerRouter.use((router) =>
  router.add("GET", "/health", HttpServerResponse.text("OK"))
);

const AllRoutes = Layer.mergeAll(
  HealthRouter,
  RpcRoute,
  BetterAuthRouterLive
).pipe(Layer.provide(CorsLayer));

HttpLayerRouter.serve(AllRoutes, {
  routerConfig: {
    maxParamLength: 500,
  },
}).pipe(
  Layer.provide(AuthLayer),
  Layer.provide(ServiceLayers),
  Layer.provide(
    BunHttpServer.layerConfig(
      Config.all({
        port: Config.number("SERVER_PORT").pipe(Config.withDefault(3000)),
        idleTimeout: Config.succeed(120),
      })
    )
  ),
  Layer.launch,
  BunRuntime.runMain
);
