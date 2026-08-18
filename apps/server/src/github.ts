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
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpHeaders from "effect/unstable/http/Headers";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ServerConfig } from "./config";

const headerValue = (
  request: HttpServerRequest.HttpServerRequest,
  name: string
): string | undefined =>
  Option.getOrUndefined(HttpHeaders.get(request.headers, name));

const settingsRedirect = (
  appUrl: string,
  status: "connected" | "error",
  message: string,
  organizationId?: string
): string => {
  const base =
    organizationId === undefined
      ? `${appUrl}/settings/integrations`
      : `${appUrl}/${organizationId}/settings/integrations`;
  return `${base}?github=${status}&message=${encodeURIComponent(message)}`;
};

/** GitHub redirects here after its App installer authorizes Feeblo to verify ownership. */
export const makeGitHubAppInstallationCallbackRouter = () =>
  HttpRouter.use((router) =>
    router.add(
      "GET",
      "/github/app/installations/callback",
      (request: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          const parsed = yield* Effect.exit(
            parseGitHubAppInstallationCallbackUrl(request.url)
          );
          if (Exit.isFailure(parsed)) {
            yield* Effect.logError(parsed.cause);
            return HttpServerResponse.redirect(
              settingsRedirect(
                config.appUrl,
                "error",
                "GitHub App installation failed."
              )
            );
          }
          const management = yield* GitHubManagementService;
          const completed = yield* Effect.exit(
            management.connectComplete(parsed.value)
          );
          if (Exit.isFailure(completed)) {
            yield* Effect.logError(completed.cause);
            return HttpServerResponse.redirect(
              settingsRedirect(
                config.appUrl,
                "error",
                "GitHub App installation failed."
              )
            );
          }
          return HttpServerResponse.redirect(
            settingsRedirect(
              config.appUrl,
              "connected",
              "Feeblo is now connected to GitHub.",
              completed.value.organizationId
            )
          );
        })
    )
  ).pipe(Layer.provide(Database.DatabaseContextLive), Layer.orDie);

/** One global GitHub App webhook endpoint. Verified payload installation IDs select the owning connection. */
const makeGitHubAppWebhookRouter = (registry: IntegrationProviderRegistry) =>
  HttpRouter.use((router) =>
    router.add(
      "POST",
      "/github/app/webhooks",
      (request: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          const inboundHandler = registry.getInboundHandler({
            capabilityKey: githubIssueWebhookCapabilityKey,
            provider: githubProviderKey,
          });
          if (inboundHandler === undefined) {
            return HttpServerResponse.text("not found", { status: 404 });
          }
          const response = yield* inboundHandler.handle({
            headers: {
              "x-github-delivery": headerValue(request, "x-github-delivery"),
              "x-github-event": headerValue(request, "x-github-event"),
              "x-hub-signature-256": headerValue(
                request,
                "x-hub-signature-256"
              ),
            },
            rawBody: yield* request.text,
          });
          if (response.status !== 200) {
            return HttpServerResponse.text(String(response.body), {
              status: response.status,
            });
          }
          const parsed = yield* Effect.exit(
            Schema.decodeUnknownEffect(
              Schema.toType(ParsedGitHubInboundRequest)
            )(response.body)
          );
          if (Exit.isFailure(parsed)) {
            return HttpServerResponse.text("invalid request payload", {
              status: 400,
            });
          }
          const inbound = yield* GitHubInboundService;
          switch (parsed.value.kind) {
            case "issue": {
              const payload = parsed.value.payload;
              if (
                payload.action !== "opened" &&
                payload.action !== "reopened" &&
                payload.action !== "closed"
              ) {
                break;
              }
              yield* inbound.applyIssueWebhook({
                deliveryId: parsed.value.deliveryId,
                eventName: "issues",
                installationId: String(payload.installation.id),
                issueNumber: payload.issue.number,
                issueState: payload.issue.state,
                repositoryName: payload.repository.name,
                repositoryOwner: payload.repository.owner.login,
              });
              break;
            }
            case "installation": {
              const action = parsed.value.payload.action;
              if (
                action === "deleted" ||
                action === "suspend" ||
                action === "unsuspend"
              ) {
                yield* inbound.applyInstallationLifecycleWebhook({
                  action,
                  deliveryId: parsed.value.deliveryId,
                  installationId: String(parsed.value.payload.installation.id),
                });
              }
              break;
            }
            case "installation_repositories":
              // Settings validate repository availability on update; this event is
              // acknowledged so GitHub does not retry a delivery with no mutation.
              break;
            default:
              return HttpServerResponse.text("unsupported GitHub App webhook", {
                status: 202,
              });
          }
          return HttpServerResponse.empty({ status: 202 });
        }).pipe(
          Effect.catch((cause) =>
            Effect.logError(cause).pipe(
              Effect.as(
                HttpServerResponse.text(
                  "GitHub App webhook processing failed",
                  { status: 500 }
                )
              )
            )
          )
        )
    )
  );

/** Server HTTP adapters for GitHub App setup and its global webhook endpoint. */
export const makeGitHubRouters = (registry: IntegrationProviderRegistry) =>
  Layer.mergeAll(
    makeGitHubAppInstallationCallbackRouter(),
    makeGitHubAppWebhookRouter(registry)
  ).pipe(Layer.orDie);
