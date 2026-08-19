import { makeClientIpGlobalMiddleware } from "@feeblo/domain/client-ip";
import { HttpRoute } from "@feeblo/domain/http/router";
import { RpcRoute } from "@feeblo/domain/rpc-router";
import type { TestMailerState } from "@feeblo/transactional/mailer/test";
import * as Layer from "effect/Layer";
import type * as Ref from "effect/Ref";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import type { ServerConfigValue } from "../config";
import { makeDiscordRouters } from "../discord";
import { makeGitHubRouters } from "../github";
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
  mailbox: Ref.Ref<TestMailerState> | undefined
) => {
  const RootRouterLive =
    mailbox === undefined
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
  integrationRuntime,
  publicRouters,
}: {
  readonly integrationRuntime: IntegrationRuntime;
  readonly publicRouters: ReturnType<typeof makePublicRouters>;
}) =>
  Layer.mergeAll(
    publicRouters,
    HealthRouter,
    RpcRoute,
    HttpRoute,
    BetterAuthRouterLive,
    DocsRoute,
    makeSlackRouters(integrationRuntime.registry),
    makeDiscordRouters(integrationRuntime.registry),
    makeGitHubRouters(integrationRuntime.registry),
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
          exposedHeaders: ["Server-Timing"],
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
