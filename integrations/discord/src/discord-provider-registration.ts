import {
  type IntegrationInboundCapabilityHandler,
  type IntegrationInboundRequest,
  type IntegrationInboundResponse,
  IntegrationPostEventData,
  type IntegrationProviderDeliveryInput,
  IntegrationProviderInvalidConfigurationError,
  type IntegrationProviderRegistration,
  type IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { type DiscordApiClient, makeDiscordApiClient } from "./discord-api";
import { renderChannelUpdateMessageEmbed } from "./discord-embeds";
import { DiscordInboundPayloadError } from "./discord-errors";
import {
  DiscordInteraction,
  type ParsedDiscordInboundRequest,
} from "./discord-inbound-schema";
import {
  DiscordChannelNotificationRouteConfiguration,
  DiscordConnectionConfiguration,
  DiscordInboundRouteConfiguration,
  discordChannelNotificationsCapabilityKey,
  discordInteractionsCapabilityKey,
  discordProviderKey,
  discordProviderManifest,
} from "./discord-manifest";
import { verifyDiscordRequestSignature } from "./discord-signature";

/**
 * Decrypted Discord provider credentials are supplied by the composition
 * root, never stored in core-safe records. The Discord bot token is
 * application-wide configuration (like the Slack signing secret), so the
 * resolver simply hands it over for every delivery.
 */
export interface DiscordProviderCredentialResolver {
  readonly loadDiscordCredentials: (
    input: IntegrationProviderDeliveryInput
  ) => Effect.Effect<
    { readonly botToken: Redacted.Redacted<string> },
    | IntegrationProviderInvalidConfigurationError
    | IntegrationProviderTemporaryFailure
  >;
}

/** Builds a credential resolver from the configured application bot token. */
export const makeDiscordCredentialResolver = ({
  botToken,
}: {
  readonly botToken: Redacted.Redacted<string>;
}): DiscordProviderCredentialResolver => ({
  loadDiscordCredentials: () => Effect.succeed({ botToken }),
});

/**
 * Parses a verified Discord interaction request body into the typed payload
 * the domain inbound service consumes. Discord posts JSON (unlike Slack's
 * form-encoded payloads), so this is a JSON decode plus a kind tag.
 */
const parseInteraction = (
  rawBody: string
): Effect.Effect<ParsedDiscordInboundRequest, DiscordInboundPayloadError> => {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return Effect.fail(
      new DiscordInboundPayloadError({
        reason: "Discord interaction body is not JSON",
      })
    );
  }
  return Schema.decodeUnknownEffect(DiscordInteraction)(json).pipe(
    Effect.map((interaction): ParsedDiscordInboundRequest => {
      switch (interaction.type) {
        case 1:
          return { kind: "ping", payload: interaction };
        case 2:
          return { kind: "application_command", payload: interaction };
        case 5:
          return { kind: "modal_submit", payload: interaction };
        default:
          return { kind: "unknown", payload: interaction };
      }
    }),
    Effect.mapError(
      () =>
        new DiscordInboundPayloadError({
          reason: "Discord interaction payload is invalid",
        })
    )
  );
};

/**
 * Creates the single inbound capability handler for Discord. Every
 * interaction (ping, slash command, context menu, modal submit) arrives at
 * one endpoint; the handler signature-verifies the request and parses the raw
 * body, leaving response shaping to the domain inbound service.
 */
const makeDiscordInteractionsHandler = ({
  publicKey,
}: {
  readonly publicKey: string;
}): IntegrationInboundCapabilityHandler => ({
  capabilityKey: discordInteractionsCapabilityKey,
  handle: (input: IntegrationInboundRequest) =>
    Effect.gen(function* () {
      const verified = yield* Effect.result(
        verifyDiscordRequestSignature({
          publicKey,
          rawBody: input.rawBody,
          signatureHeader: input.headers["x-signature-ed25519"] ?? "",
          timestampHeader: input.headers["x-signature-timestamp"] ?? "",
        })
      );
      if (Result.isFailure(verified)) {
        yield* Effect.logWarning(
          "Discord interaction signature validation failed"
        ).pipe(Effect.annotateLogs("reason", verified.failure.reason));
        return {
          body: "invalid request signature",
          status: 401,
        } satisfies IntegrationInboundResponse;
      }
      const parsed = yield* Effect.result(parseInteraction(input.rawBody));
      if (Result.isFailure(parsed)) {
        yield* Effect.logWarning(
          "Discord interaction payload validation failed"
        ).pipe(Effect.annotateLogs("reason", parsed.failure.reason));
        return {
          body: "invalid request payload",
          status: 400,
        } satisfies IntegrationInboundResponse;
      }
      return {
        body: parsed.success,
        status: 200,
      } satisfies IntegrationInboundResponse;
    }),
});

/** Creates the static Discord provider registration. */
export const makeDiscordProviderRegistration = ({
  apiClient = makeDiscordApiClient(),
  credentialResolver,
  publicKey,
}: {
  readonly apiClient?: DiscordApiClient;
  readonly credentialResolver: DiscordProviderCredentialResolver;
  readonly publicKey: string;
}): IntegrationProviderRegistration => {
  const channelNotificationsHandler = {
    capabilityKey: discordChannelNotificationsCapabilityKey,
    deliver: (input: IntegrationProviderDeliveryInput) =>
      Effect.gen(function* () {
        if (input.event.type !== "feedback.post.created") {
          return yield* new IntegrationProviderInvalidConfigurationError({
            message: "Discord channel notifications only support new posts",
            provider: discordProviderKey,
          });
        }
        const credentials =
          yield* credentialResolver.loadDiscordCredentials(input);
        const routeConfig = yield* Schema.decodeUnknownEffect(
          DiscordChannelNotificationRouteConfiguration
        )(input.route.providerConfig).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderInvalidConfigurationError({
                message: "Discord route configuration is invalid",
                provider: discordProviderKey,
              })
          )
        );
        const eventData = yield* Schema.decodeUnknownEffect(
          IntegrationPostEventData
        )(input.event.data).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderInvalidConfigurationError({
                message: "Discord event payload is invalid",
                provider: discordProviderKey,
              })
          )
        );
        const embed = renderChannelUpdateMessageEmbed({
          actionUrl: eventData.post.url.toString(),
          ...(eventData.actor.kind === "member" &&
          eventData.actor.displayName !== undefined
            ? { actorName: eventData.actor.displayName }
            : {}),
          eventType: input.event.type,
          facts: [
            { label: "Board", value: eventData.board.name },
            { label: "Status", value: eventData.post.status.type },
            ...Object.entries(eventData.post.metadata ?? {}).map(
              ([label, value]) => ({ label, value })
            ),
          ],
          title: eventData.post.title,
        });
        // Unlike Slack, Discord has no join step: the bot's channel access is
        // granted at install time through the OAuth permissions bitfield and
        // may be overridden per channel by the server. Post the embed and let
        // the typed failure algebra surface missing permissions.
        return yield* apiClient
          .channelsMessagesCreate({
            botToken: credentials.botToken,
            channelId: routeConfig.channelId,
            embeds: [embed],
          })
          .pipe(Effect.as({}));
      }),
  };

  return {
    connectionConfigurationSchema: DiscordConnectionConfiguration,
    handlers: [channelNotificationsHandler],
    inboundHandlers: [makeDiscordInteractionsHandler({ publicKey })],
    manifest: discordProviderManifest,
    routeConfigurationSchemas: new Map([
      [discordChannelNotificationsCapabilityKey, DiscordChannelNotificationRouteConfiguration],
      [discordInteractionsCapabilityKey, DiscordInboundRouteConfiguration],
    ]),
  };
};
