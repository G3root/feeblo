import type { ChannelUpdateMessage } from "@feeblo/integration-core";

export type { ChannelUpdateMessage } from "@feeblo/integration-core";

import { truncate } from "@feeblo/utils/text";

const TRUNCATED_TITLE_MAX = 150;
const TRUNCATED_CONTEXT_MAX = 3000;

const formatSlackFactLabel = (value: string): string =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");

/**
 * Renders a channel-update message into Slack Block Kit blocks for
 * `chat.postMessage`. The blocks are plain JSON values so this module stays
 * importable from browser-safe code.
 */
export const renderChannelUpdateMessageBlocks = (
  message: ChannelUpdateMessage
): readonly unknown[] => {
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncate(message.title, TRUNCATED_TITLE_MAX),
        emoji: true,
      },
    },
  ];
  const factText = message.facts
    .filter(
      ({ label, value }) => label.trim().length > 0 && value.trim().length > 0
    )
    .map(
      ({ label, value }) =>
        `*${formatSlackFactLabel(label.trim())}:* ${value.trim()}`
    )
    .join("   ·   ");
  if (factText.length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: truncate(factText, TRUNCATED_CONTEXT_MAX),
        },
      ],
    });
  }
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "View post",
          emoji: true,
        },
        url: message.actionUrl,
      },
    ],
  });
  if (message.actorName !== undefined && message.actorName.length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Posted by ${message.actorName}`,
        },
      ],
    });
  }
  return blocks;
};
