import { truncate } from "@feeblo/utils/text";

/**
 * Channel-update message model shared by channel-notification providers
 * (Slack now, Discord later). Providers render this pure model into their own
 * wire format; no provider-specific types leak into the model.
 */
export interface ChannelUpdateMessage {
  /** Absolute URL to open the post. */
  readonly actionUrl: string;
  /** Display name of the actor, when known. */
  readonly actorName?: string;
  /** Event type that produced the update. */
  readonly eventType: string;
  /** Facts rendered as key/value rows, e.g. board and status. */
  readonly facts: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
  }>;
  /** One-line excerpt of the post content; never contains HTML or markdown. */
  readonly summary: string;
  /** Post title, truncated for channel display by the renderer. */
  readonly title: string;
}

const TRUNCATED_TITLE_MAX = 150;
const TRUNCATED_SUMMARY_MAX = 280;

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
  if (message.summary.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(message.summary, TRUNCATED_SUMMARY_MAX),
      },
    });
  }
  const factText = message.facts
    .map(({ label, value }) => `*${label}:* ${value}`)
    .join("   ·   ");
  if (factText.length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: factText,
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
