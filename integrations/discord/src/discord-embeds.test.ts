import { describe, expect, it } from "vitest";
import { renderChannelUpdateMessageEmbed } from "./discord-embeds";

describe("renderChannelUpdateMessageEmbed", () => {
  const message = {
    actionUrl: "https://feeblo.example/org/post/board/slug",
    actorName: "Ada Lovelace",
    eventType: "feedback.post.created",
    facts: [
      { label: "Board", value: "Product ideas" },
      { label: "Status", value: "PENDING" },
    ],
    title: "Support dark mode",
  };

  it("renders a rich embed with title, url, facts, and actor footer", () => {
    const embed = renderChannelUpdateMessageEmbed(message);
    expect(embed.type).toBe("rich");
    expect(embed.title).toBe("Support dark mode");
    expect(embed.url).toBe(message.actionUrl);
    expect(embed.description).toBe(
      "**Board:** Product ideas\n**Status:** PENDING"
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
