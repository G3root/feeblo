import { describe, expect, it } from "vitest";

import {
  DISCORD_EMBED_TEXT_MAX,
  renderChannelUpdateMessageEmbed,
  renderDiscordFeedbackConfirmationEmbed,
  TRUNCATED_FOOTER_MAX,
  TRUNCATED_TITLE_MAX,
} from "./discord-embeds";

describe("renderChannelUpdateMessageEmbed", () => {
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

  it("renders a rich embed with title, url, facts, and actor footer", () => {
    const embed = renderChannelUpdateMessageEmbed(message);
    expect(embed.type).toBe("rich");
    expect(embed.title).toBe("Support dark mode");
    expect(embed.url).toBe(message.actionUrl);
    expect(embed.description).toBe(
      "**Board:** Product ideas\n**Status:** PENDING\n**Customer Tier:** Enterprise"
    );
    expect(embed.footer?.text).toBe("Posted by Ada Lovelace");
    expect(embed.color).toBe(0x11_18_27);
  });

  it("truncates long titles", () => {
    const embed = renderChannelUpdateMessageEmbed({
      ...message,
      title: "x".repeat(300),
    });
    expect(embed.title.length).toBeLessThanOrEqual(256);
    expect(embed.title.endsWith("…")).toBe(true);
  });

  it("truncates the complete description and footer to Discord limits", () => {
    const embed = renderChannelUpdateMessageEmbed({
      ...message,
      actorName: "a".repeat(3000),
      facts: Array.from({ length: 10 }, (_, index) => ({
        label: `Fact ${index}`,
        value: "v".repeat(1024),
      })),
    });
    expect(embed.description?.length).toBeLessThanOrEqual(4096);
    expect(embed.footer?.text.length).toBeLessThanOrEqual(2048);
    expect(embed.footer?.text.startsWith("Posted by ")).toBe(true);
  });

  it("keeps aggregate embed text at Discord's exact limit", () => {
    const embed = renderChannelUpdateMessageEmbed({
      ...message,
      title: "t".repeat(TRUNCATED_TITLE_MAX),
      actorName: "a".repeat(TRUNCATED_FOOTER_MAX),
      facts: Array.from({ length: 4 }, () => ({
        label: "Fact",
        value: "v".repeat(1024),
      })),
    });

    expect(
      embed.title.length +
        (embed.description?.length ?? 0) +
        (embed.footer?.text.length ?? 0)
    ).toBe(DISCORD_EMBED_TEXT_MAX);
  });

  it("omits the actor footer when no actor name is known", () => {
    const { actorName: _actorName, ...withoutActor } = message;
    const embed = renderChannelUpdateMessageEmbed(withoutActor);
    expect(embed).not.toHaveProperty("footer");
  });

  it("omits the description when there are no facts", () => {
    const embed = renderChannelUpdateMessageEmbed({
      ...message,
      facts: [],
    });
    expect(embed).not.toHaveProperty("description");
  });
});

describe("renderDiscordFeedbackConfirmationEmbed", () => {
  it("renders the submitted feedback and its metadata", () => {
    const embed = renderDiscordFeedbackConfirmationEmbed({
      actionUrl: "https://feeblo.example/org/post/ideas/dark-mode",
      boardName: "Product ideas",
      metadata: {
        customer_tier: "Enterprise",
        empty_value: "   ",
        region: "Asia Pacific",
      },
      postId: "post_123",
      status: "IN_PROGRESS",
      submitterName: "Ada Lovelace",
      title: "Support dark mode",
    });

    expect(embed).toMatchObject({
      title: "Support dark mode",
      url: "https://feeblo.example/org/post/ideas/dark-mode",
      description: "Your feedback was successfully added to Feeblo.",
      fields: [
        { inline: true, name: "Board", value: "Product ideas" },
        { inline: true, name: "Status", value: "In Progress" },
        { inline: true, name: "Source", value: "Discord" },
        { inline: true, name: "Submitted by", value: "Ada Lovelace" },
        { inline: false, name: "Post ID", value: "`post_123`" },
        { inline: true, name: "Customer Tier", value: "Enterprise" },
        { inline: true, name: "Region", value: "Asia Pacific" },
      ],
      footer: { text: "Only you can see this confirmation." },
    });
  });

  it("uses a safe submitter fallback and respects Discord field limits", () => {
    const embed = renderDiscordFeedbackConfirmationEmbed({
      actionUrl: "https://feeblo.example/post",
      boardName: "b".repeat(2000),
      metadata: Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [
          `metadata_${index}`,
          "v".repeat(1024),
        ])
      ),
      postId: "p".repeat(2000),
      status: "PENDING",
      submitterName: "",
      title: "Feedback",
    });

    expect(embed.fields?.[0]?.value.length).toBeLessThanOrEqual(1024);
    expect(embed.fields?.[3]?.value).toBe("Discord user");
    expect(embed.fields?.[4]?.value.length).toBeLessThanOrEqual(1024);
    expect(embed.fields?.length).toBeLessThanOrEqual(25);
    expect(
      (embed.title.length ?? 0) +
        (embed.description?.length ?? 0) +
        (embed.footer?.text.length ?? 0) +
        (embed.fields ?? []).reduce(
          (length, field) => length + field.name.length + field.value.length,
          0
        )
    ).toBeLessThanOrEqual(DISCORD_EMBED_TEXT_MAX);
  });
});
