import { currentDb, type Database, schema } from "@feeblo/db";
import {
  makeSlackApiClient,
  type SlackApiClient,
} from "@feeblo/integration-slack";
import { decryptSlackCredentialMaterial } from "@feeblo/integration-slack/credentials";
import type {
  SlackInteractivePayload,
  SlackMessageActionPayload,
  SlackSlashCommandPayload,
  SlackViewSubmissionPayload,
} from "@feeblo/integration-slack/inbound-schema";
import { slackProviderKey } from "@feeblo/integration-slack/manifest";
import { and, eq } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { BoardRepository } from "../../board/repository";
import { EmailOutboxConfig } from "../../email-outbox/config";
import { SlackIntegrationConfig } from "./config";
import { SlackInboundFailure } from "./errors";
import {
  type SlackInboundHttpResponse,
  SlackInboundService,
} from "./inbound-service";
import { SlackFeedbackService } from "./slack-feedback-service";
import {
  buildFeedbackModal,
  buildSuccessModal,
  decodeModalMetadata,
  FeedbackModalMetadata,
} from "./slack-modals";
import { SlackUserService } from "./slack-user-service";

const ephemeralResponse = (text: string): SlackInboundHttpResponse => ({
  body: { response_type: "ephemeral", text },
  status: 200,
});

const clearResponse = (): SlackInboundHttpResponse => ({
  body: { response_action: "clear" },
  status: 200,
});

/** Empty 200 acknowledgment: Slack displays nothing to the user. */
const emptyResponse = (): SlackInboundHttpResponse => ({
  status: 200,
});

/** Creates the Slack inbound service with an injectable API client. */
export const makeSlackInboundServiceLive = (
  apiClient: SlackApiClient = makeSlackApiClient()
): Layer.Layer<
  SlackInboundService,
  never,
  | Database.Database
  | SlackIntegrationConfig
  | BoardRepository
  | EmailOutboxConfig
  | SlackUserService
  | SlackFeedbackService
> =>
  Layer.effect(
    SlackInboundService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const config = yield* SlackIntegrationConfig;
      const boardRepository = yield* BoardRepository;
      const emailOutboxConfig = yield* EmailOutboxConfig;
      const slackUserService = yield* SlackUserService;
      const slackFeedbackService = yield* SlackFeedbackService;

      const findActiveConnection = (teamId: string) =>
        db
          .select()
          .from(schema.integrationConnectionTable)
          .where(
            and(
              eq(schema.integrationConnectionTable.provider, slackProviderKey),
              eq(schema.integrationConnectionTable.remoteAccountId, teamId),
              eq(schema.integrationConnectionTable.lifecycle, "active")
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

      const loadBotToken = (connection: {
        readonly credentialsCiphertext: string | null;
      }): Effect.Effect<
        Option.Option<Redacted.Redacted<string>>,
        SlackInboundFailure
      > =>
        connection.credentialsCiphertext === null
          ? Effect.succeed(Option.none())
          : decryptSlackCredentialMaterial(
              config.encryptionKey,
              connection.credentialsCiphertext
            ).pipe(
              Effect.mapError(
                () =>
                  new SlackInboundFailure({
                    message: "Slack credentials could not be decrypted",
                  })
              ),
              Effect.map((credentials) =>
                credentials.botToken === undefined
                  ? Option.none()
                  : Option.some(credentials.botToken)
              )
            );

      const openFeedbackModal = ({
        botToken,
        connectionId,
        messageTs,
        organizationId,
        teamId,
        triggerId,
        channelId,
        channelName,
        initialTitle,
      }: {
        readonly botToken: Redacted.Redacted<string>;
        readonly channelId: string;
        readonly channelName: string;
        readonly connectionId: string;
        readonly initialTitle: string;
        readonly messageTs?: string;
        readonly organizationId: string;
        readonly triggerId: string;
        readonly teamId: string;
      }) =>
        Effect.gen(function* () {
          const boards = yield* boardRepository.findMany({ organizationId });
          if (boards.length === 0) {
            return ephemeralResponse(
              "Feeblo has no boards configured yet. Ask an admin to create one."
            );
          }
          const metadata = yield* Schema.encodeEffect(
            Schema.fromJsonString(FeedbackModalMetadata)
          )({
            channelId,
            channelName,
            connectionId,
            organizationId,
            teamId,
            ...(messageTs === undefined ? {} : { messageTs }),
          }).pipe(
            Effect.mapError(
              () =>
                new SlackInboundFailure({
                  message: "Could not encode feedback modal metadata",
                })
            )
          );
          const view = buildFeedbackModal({
            boards,
            initialTitle,
            metadata,
          });
          // Open the modal through views.open with the invocation's
          // trigger_id: this is the response path every Slack surface
          // supports (slash commands and shortcuts alike). The HTTP
          // response carries an empty acknowledgment so Slack displays
          // nothing — no stray message next to the modal.
          yield* apiClient.viewsOpen({ botToken, triggerId, view }).pipe(
            Effect.mapError(
              () =>
                new SlackInboundFailure({
                  message: "Could not open the Feeblo feedback form",
                })
            )
          );
          return emptyResponse();
        });

      const handleViewSubmission = (payload: SlackViewSubmissionPayload) =>
        Effect.gen(function* () {
          const metadata = yield* decodeModalMetadata(
            payload.view.private_metadata
          ).pipe(
            Effect.mapError(
              () =>
                new SlackInboundFailure({
                  message: "Feedback modal metadata is invalid",
                })
            )
          );
          const connection = yield* findActiveConnection(metadata.teamId);
          if (connection._tag === "None") {
            return clearResponse();
          }
          const botTokenOption = yield* loadBotToken(connection.value);
          if (botTokenOption._tag === "None") {
            return clearResponse();
          }
          const botToken = botTokenOption.value;
          const values = payload.view.state.values;
          const titleInput = values.feeblo_title?.title;
          const title = titleInput?.value?.trim() ?? "";
          if (title.length === 0) {
            return {
              body: {
                errors: {
                  feeblo_title: "Please enter a title.",
                },
                response_action: "errors",
              },
              status: 200,
            };
          }
          const details = values.feeblo_details?.details?.value?.trim() ?? "";
          const boardId = values.feeblo_board?.board?.selected_option?.value;
          if (boardId === undefined) {
            return {
              body: {
                errors: {
                  feeblo_board: "Please choose a board.",
                },
                response_action: "errors",
              },
              status: 200,
            };
          }
          const userId = yield* slackUserService.resolveUser({
            botToken,
            organizationId: metadata.organizationId,
            slackTeamId: metadata.teamId,
            slackUserId: payload.user.id,
          });
          const created = yield* slackFeedbackService.createPost({
            boardId,
            content: details,
            organizationId: metadata.organizationId,
            title,
            userId,
          });
          // Swap the form modal for a success dialog. response_action:
          // "update" replaces the current view, so the user gets a clear
          // confirmation instead of the modal silently closing.
          const postUrl =
            created.boardSlug.length > 0
              ? `${emailOutboxConfig.appUrl}/${encodeURIComponent(metadata.organizationId)}/post/${encodeURIComponent(created.boardSlug)}/${encodeURIComponent(created.slug)}`
              : undefined;
          return {
            body: {
              response_action: "update",
              view: buildSuccessModal({
                postTitle: created.title,
                ...(postUrl === undefined ? {} : { postUrl }),
              }),
            },
            status: 200,
          };
        });

      const handleMessageAction = (payload: SlackMessageActionPayload) =>
        Effect.gen(function* () {
          const connection = yield* findActiveConnection(payload.team.id);
          if (connection._tag === "None") {
            return ephemeralResponse(
              "Feeblo is not connected to this Slack workspace yet."
            );
          }
          const botTokenOption = yield* loadBotToken(connection.value);
          if (botTokenOption._tag === "None") {
            return ephemeralResponse(
              "Feeblo is not connected to this Slack workspace yet."
            );
          }
          const messageText = payload.message.text.trim();
          return yield* openFeedbackModal({
            botToken: botTokenOption.value,
            channelId: payload.channel.id,
            channelName: payload.channel.name,
            connectionId: connection.value.id,
            initialTitle: messageText,
            messageTs: payload.message.ts,
            organizationId: connection.value.organizationId,
            triggerId: payload.trigger_id,
            teamId: payload.team.id,
          });
        });

      const handleSlashCommand = (payload: SlackSlashCommandPayload) =>
        Effect.gen(function* () {
          const connection = yield* findActiveConnection(payload.team_id);
          if (connection._tag === "None") {
            return ephemeralResponse(
              "Feeblo is not connected to this Slack workspace yet. Ask an admin to connect it in the Feeblo dashboard."
            );
          }
          const botTokenOption = yield* loadBotToken(connection.value);
          if (botTokenOption._tag === "None") {
            return ephemeralResponse(
              "Feeblo is not connected to this Slack workspace yet. Ask an admin to connect it in the Feeblo dashboard."
            );
          }
          const text = payload.text.trim();
          return yield* openFeedbackModal({
            botToken: botTokenOption.value,
            channelId: payload.channel_id,
            channelName: payload.channel_name,
            connectionId: connection.value.id,
            initialTitle: text,
            organizationId: connection.value.organizationId,
            triggerId: payload.trigger_id,
            teamId: payload.team_id,
          });
        });

      const handleInteractive = (payload: SlackInteractivePayload) =>
        Effect.gen(function* () {
          switch (payload.type) {
            case "message_action":
              return yield* handleMessageAction(payload);
            case "view_submission":
              // A view_submission response must be a valid response_action
              // (clear/update/push/errors); any other body makes Slack reject
              // the dispatch. On failure, log the cause and close the modal
              // so the user never sees a raw error.
              return yield* handleViewSubmission(payload).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Slack view submission failed", {
                    cause,
                  }).pipe(Effect.as(clearResponse()))
                )
              );
            case "block_actions":
              // Notification message buttons are URL buttons and never
              // produce block_actions callbacks; answer emptily to any
              // stray interaction.
              return { body: {}, status: 200 };
            default:
              // Unknown interactive payloads are acknowledged emptily so Slack
              // sees a definitive answer; `payload.type` is a closed union, so
              // this arm is defensive only.
              return { body: {}, status: 200 };
          }
        });

      const withFallback = (
        effect: Effect.Effect<SlackInboundHttpResponse, unknown>
      ): Effect.Effect<SlackInboundHttpResponse, never> =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Slack inbound request failed", { cause }).pipe(
              Effect.as(
                ephemeralResponse(
                  "Something went wrong while sending your feedback to Feeblo. Please try again."
                )
              )
            )
          )
        );

      return {
        handleInteractive: (payload) =>
          withFallback(handleInteractive(payload)),
        handleSlashCommand: (payload) =>
          withFallback(handleSlashCommand(payload)),
      };
    })
  );

/** Live layer with the default fetch-backed Slack API client. */
export const SlackInboundServiceLive = makeSlackInboundServiceLive();
