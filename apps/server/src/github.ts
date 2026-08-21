import { Database } from "@feeblo/db";
import { GitHubInboundService } from "@feeblo/domain/integration/github/inbound-service";
import { GitHubManagementService } from "@feeblo/domain/integration/github/management-service";
import { parseGitHubAppInstallationCallbackUrl } from "@feeblo/domain/integration/github/oauth-callback";
import type { IntegrationProviderRegistry } from "@feeblo/integration-core";
import { ParsedGitHubInboundRequest } from "@feeblo/integration-github/inbound-schema";
import {
  githubIssueWebhookCapabilityKey,
  githubProviderKey,
} from "@feeblo/integration-github/manifest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ServerConfig } from "./config";
import {
  handleVerifiedInbound,
  headerValue,
  settingsRedirect,
} from "./webhook-inbound";

/** GitHub redirects here after its App installer authorizes Feeblo to verify ownership. */
export const makeGitHubAppInstallationCallbackRouter = () =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      // Captured once at construction; the config is immutable.
      const config = yield* ServerConfig;
      return yield* router.add(
        "GET",
        "/github/app/installations/callback",
        (request: HttpServerRequest.HttpServerRequest) =>
          Effect.gen(function* () {
            const parsed = yield* Effect.exit(
              parseGitHubAppInstallationCallbackUrl(request.url)
            );
            if (Exit.isFailure(parsed)) {
              yield* Effect.logError(parsed.cause);
              return HttpServerResponse.redirect(
                settingsRedirect({
                  appUrl: config.appUrl,
                  message: "GitHub App installation failed.",
                  provider: "github",
                  status: "error",
                })
              );
            }
            const management = yield* GitHubManagementService;
            const completed = yield* Effect.exit(
              management.connectComplete(parsed.value)
            );
            if (Exit.isFailure(completed)) {
              yield* Effect.logError(completed.cause);
              return HttpServerResponse.redirect(
                settingsRedirect({
                  appUrl: config.appUrl,
                  message: "GitHub App installation failed.",
                  provider: "github",
                  status: "error",
                })
              );
            }
            return HttpServerResponse.redirect(
              settingsRedirect({
                appUrl: config.appUrl,
                message: "Feeblo is now connected to GitHub.",
                organizationId: completed.value.organizationId,
                provider: "github",
                status: "connected",
              })
            );
          })
      );
    })
  ).pipe(Layer.provide(Database.DatabaseContextLive), Layer.orDie);

/**
 * One global GitHub App webhook endpoint. Verified payload installation IDs
 * select the owning connection; event routing lives behind
 * GitHubInboundService so the HTTP layer only verifies, decodes, and acks.
 */
const makeGitHubAppWebhookRouter = (registry: IntegrationProviderRegistry) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      // Resolved once at construction; the registry is startup-validated and
      // immutable afterwards.
      const inboundHandler = registry.getInboundHandler({
        capabilityKey: githubIssueWebhookCapabilityKey,
        provider: githubProviderKey,
      });
      const inbound = yield* GitHubInboundService;
      return yield* router.add("POST", "/github/app/webhooks", (request) =>
        Effect.flatMap(request.text, (rawBody) =>
          handleVerifiedInbound({
            handler: inboundHandler,
            headers: {
              "x-github-delivery": headerValue(request, "x-github-delivery"),
              "x-github-event": headerValue(request, "x-github-event"),
              "x-hub-signature-256": headerValue(
                request,
                "x-hub-signature-256"
              ),
            },
            rawBody,
            schema: ParsedGitHubInboundRequest,
            respond: (parsed) =>
              // Every recognized delivery is acknowledged with 202 so GitHub
              // does not retry a delivery Feeblo has already recorded.
              Effect.as(
                inbound.applyWebhook(parsed),
                HttpServerResponse.empty({ status: 202 })
              ),
          }).pipe(
            Effect.catchTags({
              IntegrationInboundRejection: (error) =>
                Effect.logWarning("GitHub inbound request was rejected", {
                  message: error.message,
                  provider: error.provider,
                }).pipe(
                  Effect.as(
                    HttpServerResponse.text("invalid request signature", {
                      status: 401,
                    })
                  )
                ),
            }),
            // Processing failures stay 500 so GitHub redelivers; the durable
            // inbox makes replays idempotent.
            Effect.catch((cause) =>
              Effect.logError(cause).pipe(
                Effect.as(
                  HttpServerResponse.text(
                    "GitHub App webhook processing failed",
                    {
                      status: 500,
                    }
                  )
                )
              )
            )
          )
        )
      );
    })
  );

/** Server HTTP adapters for GitHub App setup and its global webhook endpoint. */
export const makeGitHubRouters = (registry: IntegrationProviderRegistry) =>
  Layer.mergeAll(
    makeGitHubAppInstallationCallbackRouter(),
    makeGitHubAppWebhookRouter(registry)
  ).pipe(Layer.orDie);
