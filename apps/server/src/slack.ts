import { Database } from "@feeblo/db";
import {
  parseSlackOAuthCallbackUrl,
  SlackInboundService,
  type SlackInboundServiceContract,
  SlackIntegrationConfig,
  SlackManagementService,
} from "@feeblo/domain/integration/slack";
import {
  type IntegrationInboundCapabilityHandler,
  IntegrationInboundRejection,
  type IntegrationProviderRegistry,
} from "@feeblo/integration-core";
import {
  handleVerifiedInbound,
  headerValue,
  inboundHttpResponse,
  settingsRedirect,
} from "@feeblo/integration-core/http-inbound";
import { ParsedSlackInboundRequest } from "@feeblo/integration-slack/inbound-schema";
import {
  slackCommandsCapabilityKey,
  slackMessageActionCapabilityKey,
  slackProviderKey,
} from "@feeblo/integration-slack/manifest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * Slack HTTP surface: the OAuth callback, the `/feeblo` slash command, and
 * interactive payloads (message actions and modal submissions). Requests are
 * signature-verified by the Slack provider inbound handlers before any domain
 * work runs; successful inbound responses carry the Slack modal JSON.
 */

/** Rejects a verified inbound request whose kind does not match this route. */
const invalidInboundPayload = Effect.succeed(
  HttpServerResponse.text("invalid inbound payload", { status: 400 })
);

/** Maps signature-verification rejections to 401 instead of a crash. */
const rejectInboundRejection = Effect.catchTags({
  IntegrationInboundRejection: (error: IntegrationInboundRejection) =>
    Effect.logWarning("Slack inbound request was rejected", {
      message: error.message,
      provider: error.provider,
    }).pipe(
      Effect.as(
        HttpServerResponse.text("invalid request signature", { status: 401 })
      )
    ),
});

const respondToSlackInbound = (
  request: HttpServerRequest.HttpServerRequest,
  inboundHandler: IntegrationInboundCapabilityHandler | undefined,
  inbound: SlackInboundServiceContract,
  expectedKind: "slash_command" | "interactive"
) =>
  Effect.flatMap(request.text, (rawBody) =>
    handleVerifiedInbound({
      handler: inboundHandler,
      headers: {
        "x-slack-request-timestamp": headerValue(
          request,
          "x-slack-request-timestamp"
        ),
        "x-slack-signature": headerValue(request, "x-slack-signature"),
      },
      rawBody,
      schema: ParsedSlackInboundRequest,
      respond: (parsed) =>
        parsed.kind !== expectedKind
          ? invalidInboundPayload
          : parsed.kind === "slash_command"
            ? Effect.map(
                inbound.handleSlashCommand(parsed.payload),
                inboundHttpResponse
              )
            : Effect.map(
                inbound.handleInteractive(parsed.payload),
                inboundHttpResponse
              ),
    }).pipe(rejectInboundRejection)
  );

/** Slash-command router for `/feeblo`. */
const makeSlackCommandRouter = (registry: IntegrationProviderRegistry) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      // Resolved once at construction; the registry is startup-validated and
      // immutable afterwards.
      const inboundHandler = registry.getInboundHandler({
        capabilityKey: slackCommandsCapabilityKey,
        provider: slackProviderKey,
      });
      const inbound = yield* SlackInboundService;
      return yield* router.add("POST", "/slack/commands/feeblo", (request) =>
        respondToSlackInbound(request, inboundHandler, inbound, "slash_command")
      );
    })
  );

/** Interactive payload router (message actions, view submissions, block actions). */
const makeSlackInteractiveRouter = (registry: IntegrationProviderRegistry) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const inboundHandler = registry.getInboundHandler({
        capabilityKey: slackMessageActionCapabilityKey,
        provider: slackProviderKey,
      });
      const inbound = yield* SlackInboundService;
      return yield* router.add("POST", "/slack/interactive", (request) =>
        respondToSlackInbound(request, inboundHandler, inbound, "interactive")
      );
    })
  );

/** OAuth callback router; completes the install and redirects to the dashboard settings page. */
export const makeSlackOAuthCallbackRouter = () =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      // Captured once at construction; the config is immutable.
      const config = yield* SlackIntegrationConfig;
      return yield* router.add(
        "GET",
        "/slack/oauth/callback",
        (request: HttpServerRequest.HttpServerRequest) =>
          Effect.gen(function* () {
            // request.url is the relative path (e.g.
            // /slack/oauth/callback?code=…); parse it without a base URL.
            const { code, error, state } = parseSlackOAuthCallbackUrl(
              request.url
            );
            if (error !== null) {
              return HttpServerResponse.redirect(
                settingsRedirect({
                  appUrl: config.appUrl,
                  message: "Slack installation was cancelled or denied.",
                  provider: "slack",
                  status: "error",
                })
              );
            }
            if (code === null || state === null) {
              return HttpServerResponse.redirect(
                settingsRedirect({
                  appUrl: config.appUrl,
                  message: "Slack installation failed.",
                  provider: "slack",
                  status: "error",
                })
              );
            }
            const management = yield* SlackManagementService;
            const completed = yield* Effect.exit(
              management.connectComplete({ code, state })
            );
            if (Exit.isFailure(completed)) {
              return HttpServerResponse.redirect(
                settingsRedirect({
                  appUrl: config.appUrl,
                  message: "Slack installation failed.",
                  provider: "slack",
                  status: "error",
                })
              );
            }
            return HttpServerResponse.redirect(
              settingsRedirect({
                appUrl: config.appUrl,
                message: "Feeblo is now connected to Slack.",
                organizationId: completed.value.organizationId,
                provider: "slack",
                status: "connected",
              })
            );
          })
      );
    })
  ).pipe(Layer.provide(Database.DatabaseContextLive), Layer.orDie);

/**
 * Complete Slack HTTP surface. The routers provide their own service layers
 * (management, inbound, repositories, database) so the composition root only
 * has to hand over the provider registry.
 */
export const makeSlackRouters = (registry: IntegrationProviderRegistry) =>
  Layer.mergeAll(
    makeSlackOAuthCallbackRouter(),
    makeSlackCommandRouter(registry),
    makeSlackInteractiveRouter(registry)
  ).pipe(Layer.orDie);
