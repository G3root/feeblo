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
import { handleOgImage } from "@feeblo/domain/og-image/handler";
import { OgImageService } from "@feeblo/domain/og-image/service";
import { RpcRoute } from "@feeblo/domain/rpc-router";
import { Auth } from "@feeblo/domain/session-middleware";
import { makeWorkflowsTest, WorkflowsLive } from "@feeblo/domain/workflows";
import { Mailer } from "@feeblo/transactional/mailer";
import {
  makeMailerTestLayer,
  TestMailer,
  type TestMailerState,
} from "@feeblo/transactional/mailer/test";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiScalar from "effect/unstable/httpapi/HttpApiScalar";
import { ServerConfig } from "./config";
import { corsVaryFix } from "./middlewares/cors-vary";

const useTestMailer = process.env.E2E_TEST_MAILER === "true";
const BetterAuthRouterLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const authApp = HttpEffect.fromWebHandler((request) =>
      Promise.resolve(auth.handler(request))
    );

    return yield* router.add("*", "/api/auth/*", (request) =>
      Effect.provideService(
        authApp,
        HttpServerRequest.HttpServerRequest,
        request
      ).pipe(Effect.orDie)
    );
  })
);

const OgImageRouterLive: Layer.Layer<never, never, HttpRouter.HttpRouter> =
  HttpRouter.use((router) =>
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

const DocsRoute = HttpApiScalar.layer(Api, {
  path: "/docs",
});

const HealthRouter: Layer.Layer<never, never, HttpRouter.HttpRouter> =
  HttpRouter.use((router) =>
    router.add(
      "GET",
      "/health",
      HttpServerResponse.jsonUnsafe({
        status: "ok",
        release: process.env.APP_RELEASE ?? "dev",
      })
    )
  );

const RootRouter = HttpRouter.use((router) =>
  router.add("GET", "/", HttpServerResponse.text("Hello world"))
);

const testMailboxRouter = (mailbox: Ref.Ref<TestMailerState>) =>
  HttpRouter.use((router) =>
    router.add(
      "GET",
      "/__e2e/emails",
      Effect.gen(function* () {
        const state = yield* Ref.get(mailbox);
        return yield* HttpServerResponse.json({
          emails: state.renderedMessages,
        });
      }).pipe(Effect.orDie)
    )
  );

const program = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const mailbox = useTestMailer ? yield* TestMailer.make : undefined;
  const makeMailerLayer = (): Layer.Layer<
    Mailer,
    Layer.Error<typeof Mailer.layer>
  > => (mailbox ? makeMailerTestLayer(mailbox) : Mailer.layer);
  const WorkFlowLayer = mailbox
    ? makeWorkflowsTest(makeMailerLayer).pipe(
        Layer.provide(Database.DatabaseContextLive)
      )
    : WorkflowsLive.pipe(
        Layer.provide(Database.DatabaseContextLive),
        Layer.provide(Database.SqlClientContextLive)
      );
  const AuthLayer = Layer.effect(
    Auth,
    mailbox ? initAuthHandler(makeMailerLayer) : initAuthHandler()
  );
  const ServiceLayers = Layer.merge(
    Database.DatabaseContextLive,
    WorkFlowLayer
  );
  const RootRouterLive: Layer.Layer<never, never, HttpRouter.HttpRouter> =
    mailbox ? Layer.merge(RootRouter, testMailboxRouter(mailbox)) : RootRouter;
  const PublicRouters: Layer.Layer<never, never, HttpRouter.HttpRouter> =
    Layer.merge(RootRouterLive, OgImageRouterLive);
  const isLocalDevHost = (host: string): boolean =>
    host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");

  const parseUrl = (value: string): URL | null =>
    Option.getOrNull(Schema.decodeUnknownOption(Schema.URLFromString)(value));

  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }

    const originUrl = parseUrl(origin);
    const appUrl = parseUrl(config.appUrl);
    const apiUrl = parseUrl(config.apiUrl);
    if (!(originUrl && appUrl && apiUrl)) {
      return false;
    }

    const originHost = originUrl.hostname;
    const appHost = appUrl.hostname;
    const apiHost = apiUrl.hostname;
    const appRootDomainHost = config.appRootDomain.includes(":")
      ? config.appRootDomain.split(":")[0]
      : config.appRootDomain;

    if (originHost === apiHost) {
      return true;
    }
    if (originHost === appHost) {
      return true;
    }

    if (
      config.nodeEnv === "development" &&
      isLocalDevHost(originHost) &&
      isLocalDevHost(appRootDomainHost ?? "")
    ) {
      return true;
    }

    if (originHost.endsWith(`.${appRootDomainHost}`)) {
      return true;
    }

    return false;
  };

  const MergedRoutes = Layer.mergeAll(
    PublicRouters,
    HealthRouter,
    RpcRoute,
    HttpRoute,
    BetterAuthRouterLive,
    DocsRoute
  );
  const AllRoutes = MergedRoutes.pipe(
    Layer.provide(
      HttpRouter.middleware(
        HttpMiddleware.cors({
          allowedOrigins: isAllowedOrigin,
          allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
          credentials: true,
          maxAge: 86_400,
        }),
        { global: true }
      )
    ),
    Layer.provide(corsVaryFix)
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
