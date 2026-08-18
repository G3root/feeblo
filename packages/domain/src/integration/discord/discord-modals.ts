import type { DiscordEmbed } from "@feeblo/integration-discord/embeds";
import { truncate } from "@feeblo/utils/text";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DiscordInboundFailure } from "./errors";

const TITLE_MAX_LENGTH = 200;
const DETAILS_MAX_LENGTH = 3000;
const BOARD_SELECT_MAX_OPTIONS = 25;
const FEEDBACK_MODAL_TITLE = "Send feedback to Feeblo";

/**
 * Metadata embedded in the feedback modal `custom_id`. Discord limits custom
 * ids to 100 characters, so this is a colon-delimited string rather than the
 * JSON Slack stores in `private_metadata`: every Feeblo id is URL-safe and
 * Discord snowflakes are digits, so the format is unambiguous.
 *
 * Budget: "feeblo:" (7) + organization id (~16) + guild/channel/message
 * snowflakes (20 each) + separators fits comfortably under the 100-character
 * limit.
 */
export const DiscordFeedbackModalMetadata = Schema.Struct({
  organizationId: Schema.String,
  guildId: Schema.String,
  channelId: Schema.String,
  messageId: Schema.optionalKey(Schema.String),
});
export type DiscordFeedbackModalMetadata = Schema.Schema.Type<
  typeof DiscordFeedbackModalMetadata
>;

export const DISCORD_FEEDBACK_MODAL_CUSTOM_ID_PREFIX = "feeblo";

/** Encodes modal metadata into the interaction `custom_id`. */
export const encodeModalMetadata = (metadata: DiscordFeedbackModalMetadata) =>
  [
    DISCORD_FEEDBACK_MODAL_CUSTOM_ID_PREFIX,
    metadata.organizationId,
    metadata.guildId,
    metadata.channelId,
    ...(metadata.messageId === undefined ? [] : [metadata.messageId]),
  ].join(":");

/** Decodes the interaction `custom_id` back into modal metadata. */
export const decodeModalMetadata = (
  customId: string
): Effect.Effect<DiscordFeedbackModalMetadata, DiscordInboundFailure> => {
  const parts = customId.split(":");
  if (
    parts[0] !== DISCORD_FEEDBACK_MODAL_CUSTOM_ID_PREFIX ||
    parts.length < 4 ||
    parts.length > 5
  ) {
    return Effect.fail(
      new DiscordInboundFailure({
        message: "Discord feedback modal custom id is malformed",
      })
    );
  }
  const [organizationId, guildId, channelId, messageId] = [
    parts[1],
    parts[2],
    parts[3],
    parts[4],
  ];
  if (
    organizationId === undefined ||
    guildId === undefined ||
    channelId === undefined
  ) {
    return Effect.fail(
      new DiscordInboundFailure({
        message: "Discord feedback modal custom id is malformed",
      })
    );
  }
  return Schema.decodeUnknownEffect(DiscordFeedbackModalMetadata)({
    ...(messageId === undefined ? undefined : { messageId }),
    channelId,
    guildId,
    organizationId,
  }).pipe(
    Effect.mapError(
      () =>
        new DiscordInboundFailure({
          message: "Discord feedback modal custom id is malformed",
        })
    )
  );
};

/** Reads a submitted value from the modal submit payload by `custom_id`. */
export const readModalValue = (
  components: readonly {
    readonly type: 18;
    readonly component:
      | { readonly type: 4; readonly custom_id: string; readonly value: string }
      | {
          readonly type: 3;
          readonly custom_id: string;
          readonly values: readonly string[];
        };
  }[],
  customId: string
): string | undefined => {
  const value = components
    .map(({ component }) => component)
    .find((component) => component.custom_id === customId);
  return value?.type === 4 ? value.value : value?.values[0];
};

/**
 * Discord `MODAL` interaction response (callback type 9) that collects a
 * feedback post. The modal's `custom_id` carries the metadata the submit
 * interaction returns.
 */
/**
 * Discord interaction callback payloads Feeblo emits (types 1, 4, 6, and 9).
 */
export type DiscordInteractionCallback =
  | { readonly type: 1 }
  | {
      readonly type: 4;
      readonly data: {
        readonly flags: 64;
        readonly content: string;
        readonly embeds?: readonly DiscordEmbed[];
      };
    }
  | { readonly type: 6 }
  | {
      readonly type: 9;
      readonly data: {
        readonly custom_id: string;
        readonly title: string;
        readonly components: readonly unknown[];
      };
    };

export const buildFeedbackModal = ({
  boards,
  customId,
  initialTitle,
}: {
  readonly boards: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly customId: string;
  readonly initialTitle: string;
}): DiscordInteractionCallback => ({
  type: 9,
  data: {
    custom_id: customId,
    title: FEEDBACK_MODAL_TITLE,
    components: [
      {
        type: 18,
        label: "Title",
        component: {
          type: 4,
          custom_id: "title",
          style: 1,
          required: true,
          max_length: TITLE_MAX_LENGTH,
          ...(initialTitle.length > 0 && {
            value: truncate(initialTitle, TITLE_MAX_LENGTH),
          }),
        },
      },
      {
        type: 18,
        label: "Details",
        component: {
          type: 4,
          custom_id: "details",
          style: 2,
          required: false,
          max_length: DETAILS_MAX_LENGTH,
        },
      },
      {
        type: 18,
        label: "Board",
        component: {
          type: 3,
          custom_id: "board",
          placeholder: "Choose a board",
          required: true,
          // Discord's string select accepts at most 25 options; cap the
          // board list so the modal stays valid for large organizations.
          options: boards.slice(0, BOARD_SELECT_MAX_OPTIONS).map((board) => ({
            label: truncate(board.name, 75),
            value: board.id,
          })),
        },
      },
    ],
  },
});

/** Discord `CHANNEL_MESSAGE_WITH_SOURCE` response with the ephemeral flag (callback type 4, flags 64). */
export const buildEphemeralMessage = (
  content: string,
  embeds: readonly DiscordEmbed[] = []
): DiscordInteractionCallback => ({
  type: 4,
  data: {
    flags: 64,
    content,
    ...(embeds.length === 0 ? undefined : { embeds }),
  },
});

/** Discord `PONG` response to a `PING` interaction (callback type 1). */
export const buildPong = (): DiscordInteractionCallback => ({ type: 1 });

/** Discord deferred-update acknowledgment for unhandled interaction types (callback type 6). */
export const buildDeferredUpdate = (): DiscordInteractionCallback => ({
  type: 6,
});
