import type { ChannelUpdateMessage } from "@feeblo/integration-core";

export type { ChannelUpdateMessage } from "@feeblo/integration-core";

import { truncate } from "@feeblo/utils/text";

const TRUNCATED_TITLE_MAX = 256;
const TRUNCATED_DESCRIPTION_MAX = 4096;
const TRUNCATED_FOOTER_MAX = 2048;
const TRUNCATED_FACT_LABEL_MAX = 256;
const TRUNCATED_FACT_VALUE_MAX = 1024;

/** Feeblo brand color rendered as the embed accent. */
const EMBED_COLOR = 0x11_18_27;

/** Rich Discord embed fields emitted for channel notifications. */
export interface DiscordEmbed {
  readonly color: number;
  readonly description?: string;
  readonly footer?: { readonly text: string };
  readonly title: string;
  readonly type: "rich";
  readonly url: string;
}

/**
 * Renders a channel-update message into a Discord message embed for
 * `channels/{id}/messages`. Embeds are plain JSON values so this module stays
 * importable from browser-safe code.
 */
export const renderChannelUpdateMessageEmbed = (
  message: ChannelUpdateMessage
): DiscordEmbed => ({
  type: "rich",
  title: truncate(message.title, TRUNCATED_TITLE_MAX),
  url: message.actionUrl,
  ...(message.facts.length > 0
    ? {
        description: truncate(
          message.facts
            .map(
              ({ label, value }) =>
                `**${truncate(label, TRUNCATED_FACT_LABEL_MAX)}:** ${truncate(
                  value,
                  TRUNCATED_FACT_VALUE_MAX
                )}`
            )
            .join("\n"),
          TRUNCATED_DESCRIPTION_MAX
        ),
      }
    : {}),
  color: EMBED_COLOR,
  ...(message.actorName !== undefined && message.actorName.length > 0
    ? {
        footer: {
          text: truncate(
            `Posted by ${message.actorName}`,
            TRUNCATED_FOOTER_MAX
          ),
        },
      }
    : {}),
});
