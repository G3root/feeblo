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

import { makeSlackApiClient, type SlackApiClient } from "./slack-api";
import { renderChannelUpdateMessageBlocks } from "./slack-blocks";
import {
  decryptSlackCredentialMaterial,
  type EncryptedSlackCredential,
} from "./slack-credentials";
import { SlackInboundPayloadError } from "./slack-errors";
import type { ParsedSlackInboundRequest } from "./slack-inbound-schema";
import {
  SlackInteractivePayload,
  SlackSlashCommandPayload,
} from "./slack-inbound-schema";
import {
  SlackChannelNotificationRouteConfiguration,
  SlackInboundRouteConfiguration,
  slackProviderKey,
  slackProviderManifest,
} from "./slack-manifest";
import { verifySlackRequestSignature } from "./slack-signature";

/** Decrypted Slack provider credentials are supplied by the composition root, never stored in core-safe records. */
export interface SlackProviderCredentialResolver {
  readonly loadSlackCredentials: (
    input: IntegrationProviderDeliveryInput
  ) => Effect.Effect<
    { readonly botToken: Redacted.Redacted<string> },
    | IntegrationProviderInvalidConfigurationError
    | IntegrationProviderTemporaryFailure
  >;
}

/** Builds a credential resolver from an encryption key and a ciphertext loader. */
export const makeSlackCredentialResolver = ({
  encryptionKey,
  loadCiphertext,
}: {
  readonly encryptionKey: Redacted.Redacted<string>;
  readonly loadCiphertext: (
    input: IntegrationProviderDeliveryInput
  ) => Effect.Effect<
    EncryptedSlackCredential | null,
    IntegrationProviderTemporaryFailure
  >;
}): SlackProviderCredentialResolver => ({
  loadSlackCredentials: (input) =>
    Effect.gen(function* () {
      const ciphertext = yield* loadCiphertext(input);
      if (ciphertext === null) {
        return yield* new IntegrationProviderInvalidConfigurationError({
          message: "Slack credentials are unavailable",
          provider: slackProviderKey,
        });
      }
      const credentials = yield* decryptSlackCredentialMaterial(
        encryptionKey,
        ciphertext
      ).pipe(
        Effect.mapError(
          () =>
            new IntegrationProviderInvalidConfigurationError({
              message: "Slack credentials are invalid",
              provider: slackProviderKey,
            })
        )
      );
      if (credentials.botToken === undefined) {
        return yield* new IntegrationProviderInvalidConfigurationError({
          message: "Slack credentials are unavailable",
          provider: slackProviderKey,
        });
      }
      return { botToken: credentials.botToken };
    }),
});

const parseFormBody = (rawBody: string): Record<string, string> => {
  const params = new URLSearchParams(rawBody);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
};

/**
 * Creates an inbound capability handler that verifies the Slack request
 * signature against the signing secret and parses the raw body into the typed
 * payload the domain inbound service consumes. Verification failures return a
 * 401/400 response so Slack sees a definitive answer without any domain work.
 */
const makeSlackInboundHandler = ({
  capabilityKey,
  parse,
  signingSecret,
}: {
  readonly capabilityKey: "commands" | "message.action";
  readonly parse: (
    rawBody: string
  ) => Effect.Effect<ParsedSlackInboundRequest, SlackInboundPayloadError>;
  readonly signingSecret: Redacted.Redacted<string>;
}): IntegrationInboundCapabilityHandler => ({
  capabilityKey,
  handle: (input: IntegrationInboundRequest) =>
    Effect.gen(function* () {
      const verified = yield* Effect.result(
        verifySlackRequestSignature({
          rawBody: input.rawBody,
          signingSecret,
          timestampHeader: input.headers["x-slack-request-timestamp"] ?? "",
          signatureHeader: input.headers["x-slack-signature"] ?? "",
        })
      );
      if (Result.isFailure(verified)) {
        return {
          body: "invalid request signature",
          status: 401,
        } satisfies IntegrationInboundResponse;
      }
      const parsed = yield* Effect.result(parse(input.rawBody));
      if (Result.isFailure(parsed)) {
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

const parseSlashCommand = (
  rawBody: string
): Effect.Effect<ParsedSlackInboundRequest, SlackInboundPayloadError> =>
  Schema.decodeUnknownEffect(SlackSlashCommandPayload)(
    parseFormBody(rawBody)
  ).pipe(
    Effect.map(
      (payload): ParsedSlackInboundRequest => ({
        kind: "slash_command",
        payload,
      })
    ),
    Effect.mapError(
      () =>
        new SlackInboundPayloadError({
          reason: "Slash command payload is invalid",
        })
    )
  );

const parseInteractive = (
  rawBody: string
): Effect.Effect<ParsedSlackInboundRequest, SlackInboundPayloadError> => {
  // Slack delivers interactive payloads (view submissions, message actions,
  // block actions) as `application/x-www-form-urlencoded` with a single
  // `payload=<urlencoded JSON>` field. Some clients send the JSON directly;
  // accept both shapes.
  const payloadJson = rawBody.startsWith("{")
    ? rawBody
    : new URLSearchParams(rawBody).get("payload");
  if (payloadJson === null) {
    return Effect.fail(
      new SlackInboundPayloadError({
        reason: "Interactive payload is missing",
      })
    );
  }
  return Schema.decodeUnknownEffect(
    Schema.fromJsonString(SlackInteractivePayload)
  )(payloadJson).pipe(
    Effect.map(
      (payload): ParsedSlackInboundRequest => ({
        kind: "interactive",
        payload,
      })
    ),
    Effect.mapError(
      () =>
        new SlackInboundPayloadError({
          reason: "Interactive payload is invalid",
        })
    )
  );
};

/** Creates the static Slack provider registration. */
export const makeSlackProviderRegistration = ({
  apiClient = makeSlackApiClient(),
  credentialResolver,
  signingSecret,
}: {
  readonly apiClient?: SlackApiClient;
  readonly credentialResolver: SlackProviderCredentialResolver;
  readonly signingSecret: Redacted.Redacted<string>;
}): IntegrationProviderRegistration => {
  const channelNotificationsHandler = {
    capabilityKey: "channel.notifications" as const,
    deliver: (input: IntegrationProviderDeliveryInput) =>
      Effect.gen(function* () {
        if (input.event.type !== "feedback.post.created") {
          return yield* new IntegrationProviderInvalidConfigurationError({
            message: "Slack channel notifications only support new posts",
            provider: slackProviderKey,
          });
        }
        const credentials =
          yield* credentialResolver.loadSlackCredentials(input);
        const routeConfig = yield* Schema.decodeUnknownEffect(
          SlackChannelNotificationRouteConfiguration
        )(input.route.providerConfig).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderInvalidConfigurationError({
                message: "Slack route configuration is invalid",
                provider: slackProviderKey,
              })
          )
        );
        const eventData = yield* Schema.decodeUnknownEffect(
          IntegrationPostEventData
        )(input.event.data).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderInvalidConfigurationError({
                message: "Slack event payload is invalid",
                provider: slackProviderKey,
              })
          )
        );
        const blocks = renderChannelUpdateMessageBlocks({
          actionUrl: eventData.post.url.toString(),
          ...(eventData.actor.kind === "member" &&
          eventData.actor.displayName !== undefined
            ? { actorName: eventData.actor.displayName }
            : {}),
          eventType: input.event.type,
          facts: [
            { label: "Board", value: eventData.board.name },
            { label: "Status", value: eventData.post.status.type },
          ],
          title: eventData.post.title,
        });
        // Join the channel before posting so notifications work without a
        // member having to add the bot manually (public channels only;
        // joining a channel the bot is already in is a no-op success).
        // Failures here are intentionally non-fatal: the postMessage call
        // below classifies the real channel problem if the bot still cannot
        // post (e.g. private channels require a member invitation).
        yield* apiClient
          .conversationsJoin({
            botToken: credentials.botToken,
            channelId: routeConfig.channelId,
          })
          .pipe(Effect.ignore);
        return yield* apiClient
          .chatPostMessage({
            blocks,
            botToken: credentials.botToken,
            channelId: routeConfig.channelId,
            text: eventData.post.title,
          })
          .pipe(Effect.as({}));
      }),
  };

  return {
    connectionConfigurationSchema: Schema.Struct({}),
    handlers: [channelNotificationsHandler],
    inboundHandlers: [
      makeSlackInboundHandler({
        capabilityKey: "commands",
        parse: parseSlashCommand,
        signingSecret,
      }),
      makeSlackInboundHandler({
        capabilityKey: "message.action",
        parse: parseInteractive,
        signingSecret,
      }),
    ],
    manifest: slackProviderManifest,
    routeConfigurationSchemas: new Map([
      ["channel.notifications", SlackChannelNotificationRouteConfiguration],
      ["commands", SlackInboundRouteConfiguration],
      ["message.action", SlackInboundRouteConfiguration],
    ]),
  };
};
