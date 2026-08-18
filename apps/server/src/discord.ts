import { isObject } from "@feeblo/utils/runtime-kind";
import { Database } from "@feeblo/db";
import {
  DiscordInboundService,
  DiscordIntegrationConfig,
  DiscordManagementService,
  parseDiscordOAuthCallbackUrl,
} from "@feeblo/domain/integration/discord";
import type { IntegrationProviderRegistry } from "@feeblo/integration-core";
import { DiscordOAuthState } from "@feeblo/integration-discord";
import type { ParsedDiscordInboundRequest } from "@feeblo/integration-discord/inbound-schema";
import {
  discordInteractionsCapabilityKey,
  discordProviderKey,
} from "@feeblo/integration-discord/manifest";
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
 * Discord HTTP surface: the OAuth callback and the single interactions
 * endpoint. Every interaction (ping, slash command, context menu, modal
 * submit) arrives at `/discord/interactions`, is signature-verified by the
 * Discord provider inbound handler before any domain work runs, and the
 * domain service answers with the interaction callback JSON.
 */

const headerValue = (
  request: HttpServerRequest.HttpServerRequest,
  name: string
): string | undefined =>
  Option.getOrUndefined(HttpHeaders.get(request.headers, name));

/**
 * Cheap narrow back to the provider's parsed payload. The inbound handler has
 * already signature-verified and fully decoded the body, so this guard only
 * discriminates on the `kind` tag instead of re-running the full schema.
 */
const isParsedDiscordInboundRequest = <T,>(
  value: T
): value is Extract<T, ParsedDiscordInboundRequest> =>
  isObject(value) &&
  value !== null &&
  "kind" in value &&
  (value.kind === "ping" ||
    value.kind === "application_command" ||
    value.kind === "modal_submit" ||
    value.kind === "unknown");

const handleInteraction = (
  request: HttpServerRequest.HttpServerRequest,
  registry: IntegrationProviderRegistry
) =>
  Effect.gen(function* () {
    const inboundHandler = registry.getInboundHandler({
      capabilityKey: discordInteractionsCapabilityKey,
      provider: discordProviderKey,
    });
    if (inboundHandler === undefined) {
      return HttpServerResponse.text("not found", { status: 404 });
    }
    const rawBody = yield* request.text;
    const response = yield* inboundHandler.handle({
      headers: {
        "x-signature-ed25519": headerValue(request, "x-signature-ed25519"),
        "x-signature-timestamp": headerValue(request, "x-signature-timestamp"),
      },
      rawBody,
    });
    if (response.status !== 200) {
      return HttpServerResponse.text(String(response.body), {
        status: response.status,
      });
    }
    // The inbound handler already signature-verified and decoded the payload;
    // its 200 body is always a `ParsedDiscordInboundRequest` produced by this
    // package. A tag-only guard restores the erased type without a second
    // full decode; a malformed body is still a client error, not a crash.
    if (!isParsedDiscordInboundRequest(response.body)) {
      return HttpServerResponse.text("invalid inbound payload", {
        status: 400,
      });
    }
    const inbound = yield* DiscordInboundService;
    const result = yield* inbound.handleInteraction(response.body.payload);
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
  return `${base}?discord=${status}&message=${encodeURIComponent(message)}`;
};

const organizationIdFromOAuthState = (state: string | null) =>
  state === null
    ? undefined
    : Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.fromJsonString(DiscordOAuthState))(
          state
        ).pipe(Option.map(({ organizationId }) => organizationId))
      );

/** OAuth callback router; completes the install and redirects to the dashboard settings page. */
export const makeDiscordOAuthCallbackRouter = () =>
  HttpRouter.use((router) =>
    router.add(
      "GET",
      "/discord/oauth/callback",
      (request: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          const config = yield* DiscordIntegrationConfig;
          // request.url is the relative path (e.g.
          // /discord/oauth/callback?code=…); parse it without a base URL.
          const { code, error, state } = parseDiscordOAuthCallbackUrl(
            request.url
          );
          if (error !== null) {
            return HttpServerResponse.redirect(
              settingsRedirect(
                config.appUrl,
                "error",
                "Discord installation was cancelled or denied.",
                organizationIdFromOAuthState(state)
              )
            );
          }
          if (code === null || state === null) {
            return HttpServerResponse.redirect(
              settingsRedirect(
                config.appUrl,
                "error",
                "Discord installation failed.",
                organizationIdFromOAuthState(state)
              )
            );
          }
          const management = yield* DiscordManagementService;
          const completed = yield* Effect.exit(
            management.connectComplete({ code, state })
          );
          if (Exit.isFailure(completed)) {
            return HttpServerResponse.redirect(
              settingsRedirect(
                config.appUrl,
                "error",
                "Discord installation failed."
              )
            );
          }
          return HttpServerResponse.redirect(
            settingsRedirect(
              config.appUrl,
              "connected",
              "Feeblo is now connected to Discord.",
              completed.value.organizationId
            )
          );
        }).pipe(Effect.orDie)
    )
  ).pipe(Layer.provide(Database.DatabaseContextLive), Layer.orDie);

/** Interactions router for every Discord interaction type. */
const makeDiscordInteractionsRouter = (registry: IntegrationProviderRegistry) =>
  HttpRouter.use((router) =>
    router.add(
      "POST",
      "/discord/interactions",
      (request: HttpServerRequest.HttpServerRequest) =>
        handleInteraction(request, registry).pipe(Effect.orDie)
    )
  );

/**
 * Complete Discord HTTP surface. The routers provide their own service layers
 * (management, inbound, repositories, database) so the composition root only
 * has to hand over the provider registry.
 */
export const makeDiscordRouters = (registry: IntegrationProviderRegistry) =>
  Layer.mergeAll(
    makeDiscordOAuthCallbackRouter(),
    makeDiscordInteractionsRouter(registry)
  ).pipe(Layer.orDie);
