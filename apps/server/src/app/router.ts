import { makeClientIpGlobalMiddleware } from "@feeblo/domain/client-ip";
import { HttpRoute } from "@feeblo/domain/http/router";
import { makeRpcRoute } from "@feeblo/domain/rpc-router";
import { makeDiscordRouters } from "@feeblo/integration-discord/routers";
import { DiscordManagementRpcHandlers } from "@feeblo/integration-discord/rpc-handlers";
import { makeGitHubRouters } from "@feeblo/integration-github/github-routers";
import { GitHubManagementRpcHandlers } from "@feeblo/integration-github/github-rpc-handlers";
import { makeSlackRouters } from "@feeblo/integration-slack/routers";
import { SlackManagementRpcHandlers } from "@feeblo/integration-slack/rpc-handlers";
import { WebhookManagementRpcHandlers } from "@feeblo/integration-webhook/rpc-handlers";
import type { TestMailerState } from "@feeblo/transactional/mailer/test";
import * as Layer from "effect/Layer";
import type * as Ref from "effect/Ref";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import type { ServerConfigValue } from "../config";
import { bodySizeLimitMiddleware } from "../http/body-limit";
import { makeIsAllowedOrigin } from "../http/cors";
import {
  e2eRoadmapSeedRouter,
  e2eSetPlanRouter,
  testMailboxRouter,
} from "../http/e2e";
import {
  BetterAuthRouterLive,
  DocsRoute,
  HealthRouter,
  OgImageRouterLive,
  RootRouter,
} from "../http/routers";
import { serverTimingMiddleware } from "../http/server-timing";
import { makeSesEmailFeedbackRouter } from "../http/ses";
import type { IntegrationRuntime } from "../integrations";

export const makePublicRouters = (
  mailbox: Ref.Ref<TestMailerState> | undefined,
  nodeEnv: string
) => {
  // E2E routers must never mount in production, even if E2E_TEST_MAILER
  // provides a mailbox.
  const RootRouterLive =
    mailbox === undefined || nodeEnv === "production"
      ? RootRouter
      : Layer.mergeAll(
          RootRouter,
          testMailboxRouter(mailbox),
          e2eRoadmapSeedRouter,
          e2eSetPlanRouter
        );
  return Layer.merge(RootRouterLive, OgImageRouterLive);
};

export const makeMergedRoutes = ({
  appUrl,
  integrationRuntime,
  publicRouters,
}: {
  /** Dashboard base URL handed to provider routers for redirects. */
  readonly appUrl: string;
  readonly integrationRuntime: IntegrationRuntime;
  readonly publicRouters: ReturnType<typeof makePublicRouters>;
}) =>
  Layer.mergeAll(
    publicRouters,
    HealthRouter,
    makeRpcRoute(
      Layer.merge(
        GitHubManagementRpcHandlers,
        Layer.merge(
          SlackManagementRpcHandlers,
          Layer.merge(
            DiscordManagementRpcHandlers,
            WebhookManagementRpcHandlers
          )
        )
      )
    ),
    HttpRoute,
    BetterAuthRouterLive,
    DocsRoute,
    makeSlackRouters({
      appUrl,
      registry: integrationRuntime.registry,
    }),
    makeDiscordRouters({
      appUrl,
      registry: integrationRuntime.registry,
    }),
    makeGitHubRouters({ appUrl, registry: integrationRuntime.registry }),
    makeSesEmailFeedbackRouter()
  );

export const withGlobalMiddleware = <A, E, R>(
  routes: Layer.Layer<A, E, R>,
  config: ServerConfigValue
) =>
  routes.pipe(
    Layer.provide(
      HttpRouter.middleware(
        HttpMiddleware.cors({
          allowedOrigins: makeIsAllowedOrigin(config),
          allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
          credentials: true,
          maxAge: 86_400,
          exposedHeaders: ["Server-Timing", "Cache-Control"],
        }),
        { global: true }
      )
    ),
    Layer.provide(
      HttpRouter.middleware(bodySizeLimitMiddleware, { global: true })
    ),
    Layer.provide(
      HttpRouter.middleware(serverTimingMiddleware, { global: true })
    ),
    // Effect-native server span for every request: parents from inbound
    // W3C traceparent / B3 headers (cross-service traces join into one
    // trace) and records http.request/response attributes. The router adds
    // `http.route` to it once a route matches.
    Layer.provide(
      HttpRouter.middleware(HttpMiddleware.tracer, { global: true })
    ),
    // Keep the tracer span noise down for the always-on health probe.
    Layer.provide(HttpMiddleware.layerTracerDisabledForUrls(["/health"])),
    // Provides the peer-anchored client IP (socket remoteAddress) to every
    // route, including RPC middleware, so public rate limits are keyed on an
    // IP the client cannot spoof via forwarding headers.
    Layer.provide(makeClientIpGlobalMiddleware(config.clientIpProxyTrust))
  );
