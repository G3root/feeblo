import { Database } from "@feeblo/db";
import {
  parseSlackOAuthCallbackUrl,
  SlackInboundService,
  SlackIntegrationConfig,
  SlackManagementService,
} from "@feeblo/domain/integration/slack";
import type { IntegrationProviderRegistry } from "@feeblo/integration-core";
import { ParsedSlackInboundRequest } from "@feeblo/integration-slack/inbound-schema";
import {
  slackCommandsCapabilityKey,
  slackMessageActionCapabilityKey,
  slackProviderKey,
} from "@feeblo/integration-slack/manifest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpHeaders from "effect/unstable/http/Headers";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * Slack HTTP surface: the OAuth callback, the `/feeblo` slash command, and
 * interactive payloads (message actions and modal submissions). Requests are
 * signature-verified by the Slack provider inbound handlers before any domain
 * work runs; successful inbound responses carry the Slack modal JSON.
 */

const headerValue = (
  request: HttpServerRequest.HttpServerRequest,
  name: string
): string | undefined =>
  Option.getOrUndefined(HttpHeaders.get(request.headers, name));

const handleInbound = (
  request: HttpServerRequest.HttpServerRequest,
  capabilityKey:
    | typeof slackCommandsCapabilityKey
    | typeof slackMessageActionCapabilityKey,
  registry: IntegrationProviderRegistry
) =>
  Effect.gen(function* () {
    const inboundHandler = registry.getInboundHandler({
      capabilityKey,
      provider: slackProviderKey,
    });
    if (inboundHandler === undefined) {
      return HttpServerResponse.text("not found", { status: 404 });
    }
    const rawBody = yield* request.text;
    const response = yield* inboundHandler.handle({
      headers: {
        "x-slack-request-timestamp": headerValue(
          request,
          "x-slack-request-timestamp"
        ),
        "x-slack-signature": headerValue(request, "x-slack-signature"),
      },
      rawBody,
    });
    if (response.status !== 200) {
      return HttpServerResponse.text(String(response.body), {
        status: response.status,
      });
    }
    // The inbound handler already signature-verified the payload; decode the
    // body at the boundary so the domain service receives a typed request. A
    // malformed body is still a client error, not a crash.
    const parsed = yield* Effect.exit(
      Schema.decodeUnknownEffect(Schema.toType(ParsedSlackInboundRequest))(
        response.body
      )
    );
    if (Exit.isFailure(parsed)) {
      return HttpServerResponse.text("invalid inbound payload", {
        status: 400,
      });
    }
    const inbound = yield* SlackInboundService;
    if (parsed.value.kind === "slash_command") {
      const result = yield* inbound.handleSlashCommand(parsed.value.payload);
      return result.body === undefined
        ? HttpServerResponse.empty({ status: result.status })
        : HttpServerResponse.jsonUnsafe(result.body, { status: result.status });
    }
    const result = yield* inbound.handleInteractive(parsed.value.payload);
    return result.body === undefined
      ? HttpServerResponse.empty({ status: result.status })
      : HttpServerResponse.jsonUnsafe(result.body, { status: result.status });
  });

const settingsRedirect = (
  appUrl: string,
  status: "connected" | "error",
  message: string,
  organizationId?: string
) => {
  const base =
    organizationId === undefined
      ? `${appUrl}/settings/integrations`
      : `${appUrl}/${organizationId}/settings/integrations`;
  return `${base}?slack=${status}&message=${encodeURIComponent(message)}`;
};

/** OAuth callback router; completes the install and redirects to the dashboard settings page. */
export const makeSlackOAuthCallbackRouter = () =>
  HttpRouter.use((router) =>
    router.add(
      "GET",
      "/slack/oauth/callback",
      (request: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          const config = yield* SlackIntegrationConfig;
          // request.url is the relative path (e.g.
          // /slack/oauth/callback?code=…); parse it without a base URL.
          const { code, error, state } = parseSlackOAuthCallbackUrl(
            request.url
          );
          if (error !== null) {
            return HttpServerResponse.redirect(
              settingsRedirect(
                config.appUrl,
                "error",
                "Slack installation was cancelled or denied."
              )
            );
          }
          if (code === null || state === null) {
            return HttpServerResponse.redirect(
              settingsRedirect(
                config.appUrl,
                "error",
                "Slack installation failed."
              )
            );
          }
          const management = yield* SlackManagementService;
          const completed = yield* Effect.exit(
            management.connectComplete({ code, state })
          );
          if (Exit.isFailure(completed)) {
            return HttpServerResponse.redirect(
              settingsRedirect(
                config.appUrl,
                "error",
                "Slack installation failed."
              )
            );
          }
          return HttpServerResponse.redirect(
            settingsRedirect(
              config.appUrl,
              "connected",
              "Feeblo is now connected to Slack.",
              completed.value.organizationId
            )
          );
        }).pipe(Effect.orDie)
    )
  ).pipe(Layer.provide(Database.DatabaseContextLive), Layer.orDie);

/** Slash-command router for `/feeblo`. */
const makeSlackCommandRouter = (registry: IntegrationProviderRegistry) =>
  HttpRouter.use((router) =>
    router.add(
      "POST",
      "/slack/commands/feeblo",
      (request: HttpServerRequest.HttpServerRequest) =>
        handleInbound(request, slackCommandsCapabilityKey, registry).pipe(
          Effect.orDie
        )
    )
  );

/** Interactive payload router (message actions, view submissions, block actions). */
const makeSlackInteractiveRouter = (registry: IntegrationProviderRegistry) =>
  HttpRouter.use((router) =>
    router.add(
      "POST",
      "/slack/interactive",
      (request: HttpServerRequest.HttpServerRequest) =>
        handleInbound(request, slackMessageActionCapabilityKey, registry).pipe(
          Effect.orDie
        )
    )
  );

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
