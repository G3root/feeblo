import { makeClientIpGlobalMiddleware } from "@feeblo/domain/client-ip";
import { HttpRoute } from "@feeblo/domain/http/router";
import { PublicApiMcpRoute } from "@feeblo/domain/public-api/mcp";
import { PublicApiRoute } from "@feeblo/domain/public-api/router";
import {
  makeRpcRoute,
  type ProviderOwnedRpcName,
} from "@feeblo/domain/rpc-router";
import { makeDiscordRouters } from "@feeblo/integration-discord/routers";
import { DiscordManagementRpcHandlers } from "@feeblo/integration-discord/rpc-handlers";
import { makeGitHubRouters } from "@feeblo/integration-github/github-routers";
import { GitHubManagementRpcHandlers } from "@feeblo/integration-github/github-rpc-handlers";
import { makeSlackRouters } from "@feeblo/integration-slack/routers";
import { SlackManagementRpcHandlers } from "@feeblo/integration-slack/rpc-handlers";
import { WebhookManagementRpcHandlers } from "@feeblo/integration-webhook/rpc-handlers";
import type { TestMailerState } from "@feeblo/transactional/mailer/test";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import type * as Ref from "effect/Ref";

import type { ServerConfigValue } from "../config";
import { bodySizeLimitMiddleware } from "../http/body-limit";
import { makeIsAllowedOrigin } from "../http/cors";
import {
  e2eRoadmapSeedRouter,
  e2eSetPlanRouter,
  testMailboxRouter,
} from "../http/e2e";
import { makeOriginCheckMiddleware } from "../http/origin-check";
import {
  BetterAuthRouterLive,
  HealthRouter,
  OgImageRouterLive,
  PublicApiDocsRoute,
  RootRouter,
} from "../http/routers";
import { serverTimingMiddleware } from "../http/server-timing";
import { SesEmailFeedbackRouter } from "../http/ses";
import type { IntegrationRuntime } from "../integrations";

/**
 * The provider-owned RPC handler layers the domain leaves to the composition
 * root (see docs/adr/0002). Keyed by the same names as the domain registry:
 * the `satisfies` below fails the server's type if a provider-owned group is
 * added to `RpcHandlerRegistrations` and not bound here.
 */
const ProviderRpcHandlers = {
  DiscordManagement: DiscordManagementRpcHandlers,
  GitHubManagement: GitHubManagementRpcHandlers,
  SlackManagement: SlackManagementRpcHandlers,
  WebhookManagement: WebhookManagementRpcHandlers,
} satisfies Record<ProviderOwnedRpcName, Layer.Layer<any, any, any>>;

type ProviderRpcHandlerLayer =
  (typeof ProviderRpcHandlers)[ProviderOwnedRpcName];

/**
 * The provider-owned handler layers as one layer, derived from the map above
 * so a new provider-owned group is bound the moment its entry is added (the
 * map's `satisfies` is what forces that entry). Listing the four names again
 * at the call site was the one place that could still drift.
 */
const ProviderRpcLayer = Layer.mergeAll(
  // SAFETY: `ProviderRpcHandlers` satisfies `Record<ProviderOwnedRpcName, …>`
  // with one entry per provider-owned group, so its values are exactly the
  // non-empty union of handler layers this tuple asserts.
  ...(Object.values(ProviderRpcHandlers) as [
    ProviderRpcHandlerLayer,
    ...ProviderRpcHandlerLayer[],
  ])
);

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
    makeRpcRoute(ProviderRpcLayer),
    HttpRoute,
    // The Public API is mounted in every environment, including production:
    // it is the paid feature, and its OpenAPI document and reference page are
    // the customer-facing docs. The dashboard's `Api` is mounted too, but has
    // no reference page of its own; its document is at `/docs/openapi.json`.
    PublicApiRoute,
    PublicApiDocsRoute,
    // The MCP surface is a projection of the same operations the route above
    // serves, gated by the same key: mounting one without the other would let
    // a key that pays for the Public API reach only half of it.
    PublicApiMcpRoute,
    BetterAuthRouterLive,
    makeSlackRouters({
      appUrl,
      registry: integrationRuntime.registry,
    }),
    makeDiscordRouters({
      appUrl,
      registry: integrationRuntime.registry,
    }),
    makeGitHubRouters({ appUrl, registry: integrationRuntime.registry }),
    SesEmailFeedbackRouter
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
    // CORS decorates responses but never blocks requests, so credentialed
    // state-changing requests need an explicit origin check (CSRF defense).
    Layer.provide(
      HttpRouter.middleware(makeOriginCheckMiddleware(config), {
        global: true,
      })
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
