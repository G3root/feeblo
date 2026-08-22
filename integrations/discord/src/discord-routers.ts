import { Database } from "@feeblo/db";
import { DiscordInboundService } from "@feeblo/domain/integration/discord/inbound-service";
import { DiscordManagementService } from "@feeblo/domain/integration/discord/management-service";
import {
  type IntegrationInboundRejection,
  type IntegrationProviderRegistry,
} from "@feeblo/integration-core";
import {
  handleVerifiedInbound,
  headerValue,
  inboundHttpResponse,
  settingsRedirect,
} from "@feeblo/integration-core/http-inbound";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ParsedDiscordInboundRequest, DiscordOAuthState } from "./discord-inbound-schema";
import {
  discordInteractionsCapabilityKey,
  discordProviderKey,
} from "./discord-manifest";
import { parseDiscordOAuthCallbackUrl } from "./discord-oauth-callback";

/**
 * Discord HTTP surface: the OAuth callback and the single interactions
 * endpoint. Every interaction (ping, slash command, context menu, modal
 * submit) arrives at `/discord/interactions`, is signature-verified by the
 * Discord provider inbound handler before any domain work runs, and the
 * domain service answers with the interaction callback JSON.
 */

/** Maps signature-verification rejections to 401 instead of a crash. */
const rejectInboundRejection = Effect.catchTags({
  IntegrationInboundRejection: (error: IntegrationInboundRejection) =>
    Effect.logWarning("Discord inbound request was rejected", {
      message: error.message,
      provider: error.provider,
    }).pipe(
      Effect.as(
        HttpServerResponse.text("invalid request signature", { status: 401 })
      )
    ),
});

/** Interactions router for every Discord interaction type. */
const makeDiscordInteractionsRouter = (registry: IntegrationProviderRegistry) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      // Resolved once at construction; the registry is startup-validated and
      // immutable afterwards.
      const inboundHandler = registry.getInboundHandler({
        capabilityKey: discordInteractionsCapabilityKey,
        provider: discordProviderKey,
      });
      const inbound = yield* DiscordInboundService;
      return yield* router.add("POST", "/discord/interactions", (request) =>
        Effect.flatMap(request.text, (rawBody) =>
          handleVerifiedInbound({
            handler: inboundHandler,
            headers: {
              "x-signature-ed25519": headerValue(
                request,
                "x-signature-ed25519"
              ),
              "x-signature-timestamp": headerValue(
                request,
                "x-signature-timestamp"
              ),
            },
            rawBody,
            schema: ParsedDiscordInboundRequest,
            respond: (parsed) =>
              Effect.map(
                inbound.handleInteraction(parsed.payload),
                inboundHttpResponse
              ),
          }).pipe(rejectInboundRejection)
        )
      );
    })
  );

const organizationIdFromOAuthState = (state: string | null) =>
  state === null
    ? undefined
    : Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.fromJsonString(DiscordOAuthState))(
          state
        ).pipe(Option.map(({ organizationId }) => organizationId))
      );

/** OAuth callback router; completes the install and redirects to the dashboard settings page. */
export const makeDiscordOAuthCallbackRouter = (appUrl: string) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      return yield* router.add(
        "GET",
        "/discord/oauth/callback",
        (request: HttpServerRequest.HttpServerRequest) =>
          Effect.gen(function* () {
            // request.url is the relative path (e.g.
            // /discord/oauth/callback?code=…); parse it without a base URL.
            const { code, error, state } = parseDiscordOAuthCallbackUrl(
              request.url
            );
            if (error !== null) {
              return HttpServerResponse.redirect(
                settingsRedirect({
                  appUrl,
                  message: "Discord installation was cancelled or denied.",
                  organizationId: organizationIdFromOAuthState(state),
                  provider: "discord",
                  status: "error",
                })
              );
            }
            if (code === null || state === null) {
              return HttpServerResponse.redirect(
                settingsRedirect({
                  appUrl,
                  message: "Discord installation failed.",
                  organizationId: organizationIdFromOAuthState(state),
                  provider: "discord",
                  status: "error",
                })
              );
            }
            const management = yield* DiscordManagementService;
            const completed = yield* Effect.exit(
              management.connectComplete({ code, state })
            );
            if (Exit.isFailure(completed)) {
              return HttpServerResponse.redirect(
                settingsRedirect({
                  appUrl,
                  message: "Discord installation failed.",
                  provider: "discord",
                  status: "error",
                })
              );
            }
            return HttpServerResponse.redirect(
              settingsRedirect({
                appUrl,
                message: "Feeblo is now connected to Discord.",
                organizationId: completed.value.organizationId,
                provider: "discord",
                status: "connected",
              })
            );
          })
      );
    })
  ).pipe(Layer.provide(Database.DatabaseContextLive), Layer.orDie);

/**
 * Server HTTP adapters for the Discord OAuth callback and its interactions
 * endpoint. Built by the composition root so the provider package never
 * depends on server configuration (see docs/adr/0002).
 */
export interface DiscordRoutersInput {
  /** Dashboard base URL used for post-installation redirects. */
  readonly appUrl: string;
  readonly registry: IntegrationProviderRegistry;
}

/**
 * Complete Discord HTTP surface. The routers provide their own database
 * context; management and inbound services are supplied by the composition
 * root's service layers.
 */
export const makeDiscordRouters = (input: DiscordRoutersInput) =>
  Layer.mergeAll(
    makeDiscordOAuthCallbackRouter(input.appUrl),
    makeDiscordInteractionsRouter(input.registry)
  ).pipe(Layer.orDie);
