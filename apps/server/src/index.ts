import { createServer } from "node:http";
import {
  NodeFileSystem,
  NodeHttpServer,
  NodePath,
  NodeRedis,
  NodeRuntime,
} from "@effect/platform-node";
import { AUTH_CLIENT_IP_HEADER } from "@feeblo/auth/auth-client-ip-header";
import { initAuthHandler } from "@feeblo/auth/server";
import { Database } from "@feeblo/db";
import { BoardRepository } from "@feeblo/domain/board/repository";
import {
  ClientIp,
  makeClientIpGlobalMiddleware,
} from "@feeblo/domain/client-ip";
import { EmailOutboxConfig } from "@feeblo/domain/email-outbox/config";
import { EmailOutboxRepository } from "@feeblo/domain/email-outbox/repository";
import { EmailProviderFeedbackConfig } from "@feeblo/domain/email-provider-feedback/config";
import { EmailProviderFeedbackService } from "@feeblo/domain/email-provider-feedback/service";
import { EmailSubscriptionRepository } from "@feeblo/domain/email-subscription/repository";
import { EntitlementPolicy } from "@feeblo/domain/entitlement/policies";
import { Api } from "@feeblo/domain/http/api";
import { HttpRoute } from "@feeblo/domain/http/router";
import { WebhookIntegrationConfig } from "@feeblo/domain/integration/config";
import {
  DiscordFeedbackServiceLive,
  DiscordInboundServiceLive,
  DiscordIntegrationConfig,
  DiscordManagementServiceLive,
  DiscordUserServiceLive,
} from "@feeblo/domain/integration/discord";
import {
  SlackFeedbackServiceLive,
  SlackInboundServiceLive,
  SlackIntegrationConfig,
  SlackManagementServiceLive,
  SlackUserServiceLive,
} from "@feeblo/domain/integration/slack";
import { handleOgImage } from "@feeblo/domain/og-image/handler";
import { OgImageService } from "@feeblo/domain/og-image/service";
import { PostRepository } from "@feeblo/domain/post/repository";
import { PostStatusRepository } from "@feeblo/domain/post-status/repository";
import { PostSubscriptionRepository } from "@feeblo/domain/post-subscription/repository";
import { RateLimitService } from "@feeblo/domain/rate-limit/service";
import { RpcRoute } from "@feeblo/domain/rpc-router";
import { Auth } from "@feeblo/domain/session-middleware";
import { SiteRepository } from "@feeblo/domain/site/repository";
import { makeWorkflowsTest, WorkflowsLive } from "@feeblo/domain/workflows";
import { WorkspaceRepository } from "@feeblo/domain/workspace/repository";
import { IntegrationEventRecorderLive } from "@feeblo/integration-core";
import { Mailer } from "@feeblo/transactional/mailer";
import {
  makeMailerTestLayer,
  TestMailer,
  type TestMailerState,
} from "@feeblo/transactional/mailer/test";
import * as Sentry from "@sentry/effect/server";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiScalar from "effect/unstable/httpapi/HttpApiScalar";
import * as RateLimiter from "effect/unstable/persistence/RateLimiter";
import { ServerConfig } from "./config";
import { makeDiscordRouters } from "./discord";
import { e2eRoadmapSeedRouter } from "./e2e-roadmap-seed";
import { e2eSetPlanRouter } from "./e2e-set-plan";
import { makeIntegrationLayers } from "./integrations";
import { makeSlackRouters } from "./slack";

const useTestMailer = process.env.E2E_TEST_MAILER === "true";
const MAX_REQUEST_BODY_BYTES = 1_000_000;

const requestBodyTooLargeResponse = (): Response =>
  new Response("Request body too large", { status: 413 });

const handleBetterAuthRequest = async ({
  handler,
  headers,
  request,
}: {
  readonly handler: (request: Request) => Promise<Response> | Response;
  readonly headers: Headers;
  readonly request: Request;
}): Promise<Response> => {
  const declaredLength = Number(headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BODY_BYTES
  ) {
    return requestBodyTooLargeResponse();
  }

  let bodyLimitExceeded = false;
  let bytesRead = 0;
  const body = request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (bodyLimitExceeded) {
          return;
        }
        bytesRead += chunk.byteLength;
        if (bytesRead > MAX_REQUEST_BODY_BYTES) {
          bodyLimitExceeded = true;
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
  let limitedRequest: Request;
  if (body) {
    const requestInit = { body, duplex: "half" as const, headers };
    limitedRequest = new Request(request, requestInit);
  } else {
    limitedRequest = new Request(request, { headers });
  }

  try {
    const response = await handler(limitedRequest);
    return bodyLimitExceeded ? requestBodyTooLargeResponse() : response;
  } catch (error) {
    if (bodyLimitExceeded) {
      return requestBodyTooLargeResponse();
    }
    throw error;
  }
};

const redisOptions = (redisUrl: string) => {
  const url = new URL(redisUrl);
  const database = Number(url.pathname.slice(1));

  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(Number.isInteger(database) && database >= 0 ? { db: database } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
};

const BetterAuthRouterLive = HttpRouter.use((router) =>
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

const OgImageRouterLive = HttpRouter.use((router) =>
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

/**
 * Limits every request body while it is read, including chunked requests that
 * omit Content-Length. Effect applies this reference to JSON, form and
 * multipart body readers before they buffer the payload.
 */
const bodySizeLimitMiddleware = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.provideService(
    httpApp,
    HttpServerRequest.MaxBodySize,
    FileSystem.Size(MAX_REQUEST_BODY_BYTES)
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
  const SentryLive: Layer.Layer<never> = config.sentryDsn
    ? Layer.mergeAll(
        Sentry.effectLayer({
          dsn: config.sentryDsn,
          enableLogs: true,
          environment: config.sentryEnvironment,
          tracesSampleRate: config.sentryTracesSampleRate,
        }),
        Layer.succeed(Tracer.Tracer, Sentry.SentryEffectTracer),
        Logger.layer([Sentry.SentryEffectLogger]),
        Sentry.SentryEffectMetricsLayer
      )
    : Layer.empty;
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
  const RateLimitStoreLayer: Layer.Layer<RateLimiter.RateLimiterStore> =
    config.nodeEnv === "test" || useTestMailer || !config.redisUrl
      ? RateLimiter.layerStoreMemory
      : RateLimiter.layerStoreRedis({ prefix: "feeblo:rate-limit" }).pipe(
          Layer.provide(NodeRedis.layer(redisOptions(config.redisUrl)))
        );
  const RateLimitLayer: Layer.Layer<RateLimitService> =
    RateLimitService.layer.pipe(
      Layer.provide(RateLimiter.layer),
      Layer.provide(RateLimitStoreLayer)
    );
  const AuthLayer = Layer.effect(
    Auth,
    initAuthHandler(makeMailerLayer, RateLimitLayer)
  );
  const integrationRuntime = yield* makeIntegrationLayers.pipe(
    Effect.provideService(ServerConfig, config)
  );
  const SlackRouters = makeSlackRouters(integrationRuntime.registry);
  const DiscordRouters = makeDiscordRouters(integrationRuntime.registry);
  const ServiceLayers = Layer.mergeAll(
    WorkFlowLayer,
    SiteRepository.layer,
    EmailOutboxRepository.layer,
    EmailProviderFeedbackConfig.layer,
    EmailProviderFeedbackService.layer,
    EmailSubscriptionRepository.layer,
    integrationRuntime.layer,
    SlackManagementServiceLive.pipe(
      Layer.provide(SlackIntegrationConfig.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    SlackInboundServiceLive.pipe(
      Layer.provide(SlackIntegrationConfig.layer),
      Layer.provide(SlackUserServiceLive),
      Layer.provide(SlackFeedbackServiceLive),
      Layer.provide(BoardRepository.layer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(IntegrationEventRecorderLive),
      Layer.provide(PostRepository.layer),
      Layer.provide(PostStatusRepository.layer),
      Layer.provide(PostSubscriptionRepository.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    DiscordManagementServiceLive.pipe(
      Layer.provide(DiscordIntegrationConfig.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    DiscordInboundServiceLive.pipe(
      Layer.provide(DiscordUserServiceLive),
      Layer.provide(DiscordFeedbackServiceLive),
      Layer.provide(BoardRepository.layer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(IntegrationEventRecorderLive),
      Layer.provide(PostRepository.layer),
      Layer.provide(PostStatusRepository.layer),
      Layer.provide(PostSubscriptionRepository.layer),
      Layer.provide(Database.DatabaseContextLive)
    ),
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  ).pipe(Layer.provideMerge(Database.DatabaseContextLive));
  const RootRouterLive: Layer.Layer<never, never, HttpRouter.HttpRouter> =
    mailbox
      ? Layer.mergeAll(
          RootRouter,
          testMailboxRouter(mailbox),
          e2eRoadmapSeedRouter,
          e2eSetPlanRouter
        )
      : RootRouter;
  const PublicRouters = Layer.merge(RootRouterLive, OgImageRouterLive);
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
    DocsRoute,
    SlackRouters,
    DiscordRouters
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
    Layer.provide(
      HttpRouter.middleware(bodySizeLimitMiddleware, { global: true })
    ),
    // Provides the peer-anchored client IP (socket remoteAddress) to every
    // route, including RPC middleware, so public rate limits are keyed on an
    // IP the client cannot spoof via forwarding headers.
    Layer.provide(makeClientIpGlobalMiddleware(config.clientIpProxyTrust))
  );

  const server = HttpRouter.serve(AllRoutes, {
    routerConfig: {
      maxParamLength: 500,
    },
  }).pipe(
    Layer.provide(AuthLayer),
    Layer.provide(RateLimitLayer),
    Layer.provide(ServiceLayers),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
    Layer.provide(SentryLive),
    Layer.provide(
      NodeHttpServer.layerConfig(
        createServer,
        Config.all({
          port: Config.number("SERVER_PORT").pipe(Config.withDefault(3000)),
        })
      )
    )
  );

  yield* integrationRuntime.worker.pipe(Effect.forkScoped);
  yield* integrationRuntime.maintenance.pipe(Effect.forkScoped);

  return yield* Layer.launch(server);
});

program.pipe(
  Effect.scoped,
  Effect.provide(
    Layer.mergeAll(
      ServerConfig.layer,
      Database.DatabaseContextLive,
      WebhookIntegrationConfig.layer,
      SlackIntegrationConfig.layer,
      DiscordIntegrationConfig.layer
    )
  ),
  NodeRuntime.runMain
);
