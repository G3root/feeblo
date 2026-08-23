import type { ChannelUpdateMessage } from "@feeblo/integration-core";

export type { ChannelUpdateMessage } from "@feeblo/integration-core";

/**
 * Rich Discord embed vocabulary; canonical definitions live in
 * @feeblo/domain-contracts so the interaction callback contract can reference
 * them (see docs/adr/0002).
 */
import type {
  DiscordEmbed,
  DiscordEmbedField,
} from "@feeblo/domain-contracts/discord-inbound";

export type { DiscordEmbed, DiscordEmbedField };

import { truncate } from "@feeblo/utils/text";

/** Discord's maximum aggregate text length across an embed's title, description, and footer. */
export const DISCORD_EMBED_TEXT_MAX = 6000;

/** Discord's maximum embed title length. */
export const TRUNCATED_TITLE_MAX = 256;
/** Discord's maximum embed description length. */
export const TRUNCATED_DESCRIPTION_MAX = 4096;
/** Discord's maximum embed footer length. */
export const TRUNCATED_FOOTER_MAX = 2048;
const TRUNCATED_FACT_LABEL_MAX = 256;
const TRUNCATED_FACT_VALUE_MAX = 1024;
const DISCORD_EMBED_FIELD_MAX = 25;

/** Feeblo brand color rendered as the embed accent. */
const EMBED_COLOR = 0x11_18_27;

/** Metadata shown after Discord feedback is successfully submitted. */
export interface DiscordFeedbackConfirmation {
  readonly actionUrl: string;
  readonly boardName: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly postId: string;
  readonly status: string;
  readonly submitterName: string;
  readonly title: string;
}

const formatDiscordMetadataValue = (value: string): string =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");

/** Renders the private success confirmation for feedback submitted from Discord. */
export const renderDiscordFeedbackConfirmationEmbed = (
  confirmation: DiscordFeedbackConfirmation
): DiscordEmbed => {
  const title = truncate(confirmation.title, TRUNCATED_TITLE_MAX);
  const description = "Your feedback was successfully added to Feeblo.";
  const footer = { text: "Only you can see this confirmation." };
  const postFields: readonly DiscordEmbedField[] = [
    {
      inline: true,
      name: "Board",
      value: truncate(confirmation.boardName, TRUNCATED_FACT_VALUE_MAX),
    },
    {
      inline: true,
      name: "Status",
      value: truncate(
        formatDiscordMetadataValue(confirmation.status),
        TRUNCATED_FACT_VALUE_MAX
      ),
    },
    {
      inline: true,
      name: "Source",
      value: "Discord",
    },
    {
      inline: true,
      name: "Submitted by",
      value: truncate(
        confirmation.submitterName || "Discord user",
        TRUNCATED_FACT_VALUE_MAX
      ),
    },
    {
      inline: false,
      name: "Post ID",
      value: `\`${truncate(confirmation.postId, TRUNCATED_FACT_VALUE_MAX - 2)}\``,
    },
  ];
  let remainingTextLength =
    DISCORD_EMBED_TEXT_MAX -
    title.length -
    description.length -
    footer.text.length -
    postFields.reduce(
      (length, field) => length + field.name.length + field.value.length,
      0
    );
  const metadataFields: DiscordEmbedField[] = [];
  for (const [metadataName, metadataValue] of Object.entries(
    confirmation.metadata
  )) {
    if (
      metadataFields.length >= DISCORD_EMBED_FIELD_MAX - postFields.length ||
      remainingTextLength <= 0
    ) {
      break;
    }
    const name = truncate(
      formatDiscordMetadataValue(metadataName.trim()),
      TRUNCATED_FACT_LABEL_MAX
    );
    const normalizedValue = metadataValue.trim();
    if (name.length === 0 || normalizedValue.length === 0) {
      continue;
    }
    const availableValueLength = Math.min(
      TRUNCATED_FACT_VALUE_MAX,
      remainingTextLength - name.length
    );
    if (availableValueLength <= 0) {
      break;
    }
    const value = truncate(normalizedValue, availableValueLength);
    metadataFields.push({ inline: true, name, value });
    remainingTextLength -= name.length + value.length;
  }

  return {
    type: "rich",
    title,
    url: confirmation.actionUrl,
    description,
    color: EMBED_COLOR,
    fields: [...postFields, ...metadataFields],
    footer,
  };
};

/**
 * Renders a channel-update message into a Discord message embed for
 * `channels/{id}/messages`. Embeds are plain JSON values so this module stays
 * importable from browser-safe code.
 */
export const renderChannelUpdateMessageEmbed = (
  message: ChannelUpdateMessage
): DiscordEmbed => {
  const title = truncate(message.title, TRUNCATED_TITLE_MAX);
  const footer =
    message.actorName !== undefined && message.actorName.length > 0
      ? {
          text: truncate(
            `Posted by ${message.actorName}`,
            TRUNCATED_FOOTER_MAX
          ),
        }
      : undefined;
  const descriptionMax = Math.min(
    TRUNCATED_DESCRIPTION_MAX,
    DISCORD_EMBED_TEXT_MAX - title.length - (footer?.text.length ?? 0)
  );

  return {
    type: "rich",
    title,
    url: message.actionUrl,
    ...(message.facts.length > 0 && {
      description: truncate(
        message.facts
          .map(
            ({ label, value }) =>
              `**${truncate(
                formatDiscordMetadataValue(label),
                TRUNCATED_FACT_LABEL_MAX
              )}:** ${truncate(value, TRUNCATED_FACT_VALUE_MAX)}`
          )
          .join("\n"),
        descriptionMax
      ),
    }),
    color: EMBED_COLOR,
    ...(footer === undefined ? undefined : { footer }),
  };
};
