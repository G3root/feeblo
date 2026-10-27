import { makeClientIpGlobalMiddleware } from "@feeblo/domain/client-ip";
import { HttpRoute } from "@feeblo/domain/http/router";
import { PublicApiMcpRoute } from "@feeblo/domain/public-api/mcp";
import { PublicApiRoute } from "@feeblo/domain/public-api/router";
import {
  makeRpcRoute,
  type ProviderOwnedRpcName,
} from "@feeblo/domain/rpc-router";
import { WidgetApiRoute } from "@feeblo/domain/widget/router";
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
import { makeAgentDiscoveryRouter } from "../http/agent-discovery";
import { bodySizeLimitMiddleware } from "../http/body-limit";
import { makeIsAllowedOrigin } from "../http/cors";
import {
  e2eRoadmapSeedRouter,
  e2eSetPlanRouter,
  testMailboxRouter,
} from "../http/e2e";
import { httpMetricsMiddleware } from "../http/http-metrics";
import { makeOriginCheckMiddleware } from "../http/origin-check";
import { requestRejectionMiddleware } from "../http/request-rejection";
import {
  BetterAuthRouterLive,
  HealthRouter,
  OgImageRouterLive,
  PublicApiDocsRoute,
} from "../http/routers";
import {
  deploymentServesHttps,
  makeSecurityHeadersMiddleware,
} from "../http/security-headers";
import { serverTimingMiddleware } from "../http/server-timing";
import { SesEmailFeedbackRouter } from "../http/ses";
import { errorReportingMiddleware } from "../infra/sentry";
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

/**
 * Whether the test-only routers mount.
 *
 * Extracted so the rule is testable without building a route tree: an
 * explicit route flag, a mailbox to serve, and an environment that is not
 * production. The mailer flag alone must never be enough, because
 * `/__e2e/emails` hands out every rendered email — including password-reset
 * links and verification codes — to an unauthenticated caller.
 */
export const shouldMountE2eRoutes = ({
  e2eRoutesEnabled,
  hasMailbox,
  nodeEnv,
}: {
  readonly e2eRoutesEnabled: boolean;
  readonly hasMailbox: boolean;
  readonly nodeEnv: string;
}): boolean => e2eRoutesEnabled && hasMailbox && nodeEnv !== "production";

export const makePublicRouters = ({
  apiUrl,
  e2eRoutesEnabled,
  mailbox: inputMailbox,
  nodeEnv,
}: {
  /**
   * The public origin this deployment serves the API from. Discovery documents
   * use its scheme when no proxy supplies one.
   */
  readonly apiUrl: string;
  /**
   * Explicit opt-in for the test-only routes. Separate from
   * `E2E_TEST_MAILER` on purpose: a deployment that only wanted the in-memory
   * mailer must not also serve `/__e2e/emails`, `/__e2e/set-plan`, or
   * `/__e2e/seed-roadmap` to the network.
   */
  readonly e2eRoutesEnabled: boolean;
  readonly mailbox: Ref.Ref<TestMailerState> | undefined;
  readonly nodeEnv: string;
}) => {
  // Two independent opt-ins plus the production gate: the mailer flag alone
  // mounts nothing, and production never mounts them even if both are set
  // (`ServerConfig` refuses to start with either in production).
  const mailbox = shouldMountE2eRoutes({
    e2eRoutesEnabled,
    hasMailbox: inputMailbox !== undefined,
    nodeEnv,
  })
    ? inputMailbox
    : undefined;
  const DiscoveryRouter = makeAgentDiscoveryRouter(apiUrl);
  const RootRouterLive =
    mailbox === undefined
      ? DiscoveryRouter
      : Layer.mergeAll(
          DiscoveryRouter,
          testMailboxRouter(mailbox),
          e2eRoadmapSeedRouter,
          e2eSetPlanRouter
        );
  return Layer.merge(RootRouterLive, OgImageRouterLive);
};

export const makeMergedRoutes = ({
  appUrl,
  browserTelemetry,
  integrationRuntime,
  publicRouters,
}: {
  /** Dashboard base URL handed to provider routers for redirects. */
  readonly appUrl: string;
  /**
   * Browser OTLP relay. Built from the server's own OTLP config so the
   * browser's spans land in the same backend as the server's, without the
   * collector credential ever reaching the page.
   */
  readonly browserTelemetry: Layer.Layer<never, never, HttpRouter.HttpRouter>;
  readonly integrationRuntime: IntegrationRuntime;
  readonly publicRouters: ReturnType<typeof makePublicRouters>;
}) =>
  Layer.mergeAll(
    publicRouters,
    browserTelemetry,
    HealthRouter,
    makeRpcRoute(ProviderRpcLayer),
    HttpRoute,
    // The widget is its own surface with its own `HttpApi` and its own version
    // prefix, so it is mounted beside `HttpRoute` rather than inside it: the
    // dashboard's `/docs/openapi.json` describes the dashboard only, and the
    // widget's shared dependencies are supplied by the same service graph
    // because the route declares them (see `@feeblo/domain/widget/router`).
    WidgetApiRoute,
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
    // Framing and content-type controls for every response, error bodies and
    // router-level 404s included. See `http/security-headers.ts` for why the
    // policy has no `default-src` and why the session cookie makes framing the
    // load-bearing directive.
    Layer.provide(
      HttpRouter.middleware(
        makeSecurityHeadersMiddleware({
          includeHsts: deploymentServesHttps(config),
        }),
        { global: true }
      )
    ),
    Layer.provide(
      HttpRouter.middleware(serverTimingMiddleware, { global: true })
    ),
    // Exact HTTP request rate and latency, independent of trace sampling.
    Layer.provide(
      HttpRouter.middleware(httpMetricsMiddleware, { global: true })
    ),
    // Records why the HTTP API rejected a request body, query, or parameter on
    // the request span: the 400 is answered before any handler runs.
    Layer.provide(
      HttpRouter.middleware(requestRejectionMiddleware, { global: true })
    ),
    // Every failure that propagates out of a request reaches the configured
    // reporters (Sentry); client rejections are filtered inside the reporter.
    Layer.provide(
      HttpRouter.middleware(errorReportingMiddleware, { global: true })
    ),
    // Provides the peer-anchored client IP (socket remoteAddress) to every
    // route, including RPC middleware, so public rate limits are keyed on an
    // IP the client cannot spoof via forwarding headers.
    Layer.provide(makeClientIpGlobalMiddleware(config.clientIpProxyTrust))
  );
