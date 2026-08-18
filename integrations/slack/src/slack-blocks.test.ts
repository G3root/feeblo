import { describe, expect, it } from "vitest";

import { renderChannelUpdateMessageBlocks } from "./slack-blocks";

describe("renderChannelUpdateMessageBlocks", () => {
  const message = {
    actionUrl: "https://feeblo.example/org/post/board/slug",
    actorName: "Ada Lovelace",
    eventType: "feedback.post.created",
    facts: [
      { label: "Board", value: "Product ideas" },
      { label: "Status", value: "PENDING" },
      { label: "customer_tier", value: "Enterprise" },
    ],
    title: "Support dark mode",
  };

  it("renders a header, context facts, action button, and actor context", () => {
    const blocks = renderChannelUpdateMessageBlocks(message);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({
      type: "header",
      text: { type: "plain_text", emoji: true, text: "Support dark mode" },
    });
    expect(blocks[1]).toEqual({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "*Board:* Product ideas   ·   *Status:* PENDING   ·   *Customer Tier:* Enterprise",
        },
      ],
    });
    expect(blocks[2]).toEqual({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", emoji: true, text: "View post" },
          url: message.actionUrl,
        },
      ],
    });
    expect(blocks[3]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "Posted by Ada Lovelace" }],
    });
  });

  it("truncates long titles", () => {
    const blocks = renderChannelUpdateMessageBlocks({
      ...message,
      title: "x".repeat(200),
    });
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text.length).toBeLessThanOrEqual(150);
    expect(header.text.text.endsWith("…")).toBe(true);
  });

  it("omits the actor context when no actor name is known", () => {
    const { actorName: _actorName, ...withoutActor } = message;
    const blocks = renderChannelUpdateMessageBlocks(withoutActor);
    expect(blocks.at(-1)).toEqual({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", emoji: true, text: "View post" },
          url: message.actionUrl,
        },
      ],
    });
  });
});
