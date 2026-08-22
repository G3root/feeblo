import { makeClientIpGlobalMiddleware } from "@feeblo/domain/client-ip";
import { HttpRoute } from "@feeblo/domain/http/router";
import { makeRpcRoute } from "@feeblo/domain/rpc-router";
import { GitHubManagementRpcHandlers } from "@feeblo/integration-github/github-rpc-handlers";
import type { TestMailerState } from "@feeblo/transactional/mailer/test";
import * as Layer from "effect/Layer";
import type * as Ref from "effect/Ref";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import type { ServerConfigValue } from "../config";
import { makeDiscordRouters } from "../discord";
import { makeGitHubRouters } from "@feeblo/integration-github/github-routers";
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
import { makeSlackRouters } from "../slack";

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
    makeRpcRoute(GitHubManagementRpcHandlers),
    HttpRoute,
    BetterAuthRouterLive,
    DocsRoute,
    makeSlackRouters(integrationRuntime.registry),
    makeDiscordRouters(integrationRuntime.registry),
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
    // Provides the peer-anchored client IP (socket remoteAddress) to every
    // route, including RPC middleware, so public rate limits are keyed on an
    // IP the client cannot spoof via forwarding headers.
    Layer.provide(makeClientIpGlobalMiddleware(config.clientIpProxyTrust))
  );
