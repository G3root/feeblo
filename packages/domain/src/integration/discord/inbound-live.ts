import { currentDb, type Database, schema } from "@feeblo/db";
import {
  type DiscordEmbed,
  renderDiscordFeedbackConfirmationEmbed,
} from "@feeblo/integration-discord/embeds";
import type {
  DiscordApplicationCommandPayload,
  DiscordInteraction,
  DiscordModalSubmitPayload,
} from "@feeblo/integration-discord/inbound-schema";
import { discordProviderKey } from "@feeblo/integration-discord/manifest";
import { isString } from "@feeblo/utils/runtime-kind";
import { and, eq } from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BoardRepository } from "../../board/repository";
import { EmailOutboxConfig } from "../../email-outbox/config";
import { DiscordFeedbackService } from "./discord-feedback-service";
import {
  buildDeferredUpdate,
  buildEphemeralMessage,
  buildFeedbackModal,
  buildPong,
  decodeModalMetadata,
  encodeModalMetadata,
  readModalValue,
} from "./discord-modals";
import { DiscordUserService } from "./discord-user-service";
import { DiscordInboundFailure } from "./errors";
import {
  type DiscordInboundHttpResponse,
  DiscordInboundService,
} from "./inbound-service";

const TITLE_INPUT_MAX = 200;

/** Slack-style ephemeral response; the only content Discord users see for errors. */
const ephemeralMessageResponse = (
  text: string,
  embeds: readonly DiscordEmbed[] = []
): DiscordInboundHttpResponse => ({
  body: buildEphemeralMessage(text, embeds),
  status: 200,
});

const pongResponse = (): DiscordInboundHttpResponse => ({
  body: buildPong(),
  status: 200,
});

const deferredUpdateResponse = (): DiscordInboundHttpResponse => ({
  body: buildDeferredUpdate(),
  status: 200,
});

/** Reads the invoking user's display name from the interaction payload. */
const interactionDisplayName = (
  payload: DiscordApplicationCommandPayload | DiscordModalSubmitPayload
): string => {
  const user = payload.member?.user ?? payload.user;
  if (user === undefined) {
    return "";
  }
  return user.global_name ?? user.username;
};

/** Reads the `/feeblo` `text` option value from a slash command invocation. */
const slashCommandText = (
  payload: DiscordApplicationCommandPayload
): string | undefined => {
  const value = payload.data.options?.find(
    (option) => option.name === "text"
  )?.value;
  return isString(value) ? value : undefined;
};

/** Reads the target message content from a message context menu invocation. */
const messageContextMenuText = (
  payload: DiscordApplicationCommandPayload
): string | undefined => {
  if (payload.data.target_id === undefined) {
    return undefined;
  }
  return payload.data.resolved?.messages?.[payload.data.target_id]?.content;
};

/**
 * Creates the Discord inbound service. Discord interaction responses are the
 * HTTP response itself (modals and ephemeral messages need no API call), so
 * unlike Slack this service needs no bot token: the invoking user and target
 * message arrive inside the verified payload.
 */
export const makeDiscordInboundServiceLive = (): Layer.Layer<
  DiscordInboundService,
  never,
  | Database.Database
  | BoardRepository
  | EmailOutboxConfig
  | DiscordUserService
  | DiscordFeedbackService
> =>
  Layer.effect(
    DiscordInboundService,
    Effect.gen(function* () {
      const db = yield* currentDb;
      const boardRepository = yield* BoardRepository;
      const emailOutboxConfig = yield* EmailOutboxConfig;
      const discordUserService = yield* DiscordUserService;
      const discordFeedbackService = yield* DiscordFeedbackService;

      const findActiveConnection = (guildId: string) =>
        db
          .select()
          .from(schema.integrationConnectionTable)
          .where(
            and(
              eq(
                schema.integrationConnectionTable.provider,
                discordProviderKey
              ),
              eq(schema.integrationConnectionTable.remoteAccountId, guildId),
              eq(schema.integrationConnectionTable.lifecycle, "active")
            )
          )
          .limit(1)
          .pipe(Effect.map(EffectArray.get(0)));

      const openFeedbackModal = ({
        channelId,
        guildId,
        initialTitle,
        messageId,
        organizationId,
      }: {
        readonly channelId: string;
        readonly guildId: string;
        readonly initialTitle: string;
        readonly messageId?: string;
        readonly organizationId: string;
      }) =>
        Effect.gen(function* () {
          const boards = yield* boardRepository.findMany({ organizationId });
          if (boards.length === 0) {
            return ephemeralMessageResponse(
              "Feeblo has no boards configured yet. Ask an admin to create one."
            );
          }
          const customId = encodeModalMetadata({
            ...(messageId === undefined ? undefined : { messageId }),
            channelId,
            guildId,
            organizationId,
          });
          return {
            body: buildFeedbackModal({ boards, customId, initialTitle }),
            status: 200,
          } satisfies DiscordInboundHttpResponse;
        });

      const handleApplicationCommand = (
        payload: DiscordApplicationCommandPayload
      ) =>
        Effect.gen(function* () {
          const connection = yield* findActiveConnection(payload.guild_id);
          if (connection._tag === "None") {
            return ephemeralMessageResponse(
              "Feeblo is not connected to this Discord server yet. Ask an admin to connect it in the Feeblo dashboard."
            );
          }
          const messageText =
            payload.data.type === 3
              ? messageContextMenuText(payload)
              : slashCommandText(payload);
          return yield* openFeedbackModal({
            channelId: payload.channel_id,
            guildId: payload.guild_id,
            initialTitle: (messageText ?? "").trim().slice(0, TITLE_INPUT_MAX),
            ...(payload.data.type === 3 &&
              payload.data.target_id !== undefined && {
                messageId: payload.data.target_id,
              }),
            organizationId: connection.value.organizationId,
          });
        });

      const handleModalSubmit = (payload: DiscordModalSubmitPayload) =>
        Effect.gen(function* () {
          const metadata = yield* decodeModalMetadata(payload.data.custom_id);
          const connection = yield* findActiveConnection(metadata.guildId);
          if (connection._tag === "None") {
            return ephemeralMessageResponse(
              "Feeblo is not connected to this Discord server anymore."
            );
          }
          const values = payload.data.components;
          const title = readModalValue(values, "title")?.trim() ?? "";
          if (title.length === 0) {
            return ephemeralMessageResponse(
              "Please enter a title, then run /feeblo again."
            );
          }
          const details = readModalValue(values, "details")?.trim() ?? "";
          const boardId = readModalValue(values, "board")?.trim() ?? "";
          if (boardId.length === 0) {
            return ephemeralMessageResponse(
              "Please choose a board, then run /feeblo again."
            );
          }
          const invokingUserId = payload.member?.user.id ?? payload.user?.id;
          if (invokingUserId === undefined) {
            return yield* new DiscordInboundFailure({
              message: "Discord interaction user is missing",
            });
          }
          const userId = yield* discordUserService.resolveUser({
            displayName: interactionDisplayName(payload),
            guildId: metadata.guildId,
            userId: invokingUserId,
          });
          const created = yield* discordFeedbackService.createPost({
            boardId,
            content: details,
            organizationId: metadata.organizationId,
            title,
            userId,
          });
          const postUrl =
            created.boardSlug.length > 0
              ? `${emailOutboxConfig.appUrl}/${encodeURIComponent(metadata.organizationId)}/post/${encodeURIComponent(created.boardSlug)}/${encodeURIComponent(created.slug)}`
              : undefined;
          if (postUrl === undefined) {
            return ephemeralMessageResponse(
              `✅ Feedback sent: ${created.title}`
            );
          }
          const confirmationEmbed = renderDiscordFeedbackConfirmationEmbed({
            actionUrl: postUrl,
            boardName: created.boardName,
            metadata: created.metadata,
            postId: created.id,
            status: created.status,
            submitterName: interactionDisplayName(payload),
            title: created.title,
          });
          return ephemeralMessageResponse(
            "✅ Feedback sent to Feeblo. Select the title below to view it.",
            [confirmationEmbed]
          );
        });

      const handleInteraction = (payload: DiscordInteraction) =>
        Effect.gen(function* () {
          switch (payload.type) {
            case 1:
              // Discord requires a PONG within 3 seconds of a ping.
              return pongResponse();
            case 2:
              return yield* handleApplicationCommand(payload);
            case 5:
              return yield* handleModalSubmit(payload);
            default:
              // Message components and autocomplete never fire (embeds carry no
              // components and no option is autocomplete-backed); answer with a
              // deferred acknowledgment so Discord sees a definitive response.
              return deferredUpdateResponse();
          }
        });

      const withFallback = (
        effect: Effect.Effect<DiscordInboundHttpResponse, unknown>
      ): Effect.Effect<DiscordInboundHttpResponse, never> =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Discord inbound request failed", { cause }).pipe(
              Effect.as(
                ephemeralMessageResponse(
                  "Something went wrong while sending your feedback to Feeblo. Please try again."
                )
              )
            )
          )
        );

      return {
        handleInteraction: (payload) =>
          withFallback(handleInteraction(payload)),
      };
    })
  );

/** Live layer with real repositories and the default database context. */
export const DiscordInboundServiceLive = makeDiscordInboundServiceLive();
