import { describe, expect, it } from "vitest";

import {
  buildHelpCenterSections,
  findHelpCenterSiblings,
  formatHelpDate,
  readingMinutes,
  UNLISTED_SECTION_KEY,
} from "./content";

const article = (id: string, topicId: string, slug = id) => ({
  excerpt: `About ${id}`,
  id,
  isArchived: false,
  slug,
  title: id,
  topicId,
});

const topic = (id: string, articleCount = 1) => ({
  articleCount,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  description: null,
  icon: null,
  id,
  name: `Topic ${id}`,
  organizationId: "org_1",
  position: 0,
  slug: `topic-${id}`,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

describe("buildHelpCenterSections", () => {
  it("keeps the server's topic order and buckets each article under its topic", () => {
    const sections = buildHelpCenterSections({
      articles: [article("a", "t1"), article("b", "t2"), article("c", "t1")],
      topics: [topic("t2"), topic("t1")],
    });

    expect(sections.map((section) => section.key)).toEqual(["t2", "t1"]);
    expect(sections[1]?.articles.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("collects articles whose topic is not listed into their own section", () => {
    // A topic with only archived articles is not listed on the portal while its
    // articles stay readable, so the tree has to hold them somewhere.
    const sections = buildHelpCenterSections({
      articles: [article("a", "t1"), article("orphan", "t9")],
      topics: [topic("t1")],
    });

    const last = sections.at(-1);

    expect(last?.key).toBe(UNLISTED_SECTION_KEY);
    expect(last?.isTopic).toBe(false);
    expect(last?.articles.map((item) => item.id)).toEqual(["orphan"]);
  });

  it("has no unlisted section when every article's topic is listed", () => {
    const sections = buildHelpCenterSections({
      articles: [article("a", "t1")],
      topics: [topic("t1")],
    });

    expect(sections.map((section) => section.key)).toEqual(["t1"]);
  });

  it("renders the topic rows from the topic read, not from the articles", () => {
    const sections = buildHelpCenterSections({
      articles: [],
      topics: [topic("t1", 3)],
    });

    expect(sections[0]?.articles).toEqual([]);
  });
});

describe("findHelpCenterSiblings", () => {
  const sections = buildHelpCenterSections({
    articles: [
      article("a", "t1"),
      article("b", "t1"),
      article("d", "t1"),
      article("c", "t2"),
    ],
    topics: [topic("t1", 3), topic("t2")],
  });

  it("names the section an article sits in", () => {
    const found = findHelpCenterSiblings({ articleId: "b", sections });

    expect(found.section?.key).toBe("t1");
    expect(found.index).toBe(1);
  });

  it("offers both neighbours in the middle of a section", () => {
    const found = findHelpCenterSiblings({ articleId: "b", sections });

    expect(found.previous?.id).toBe("a");
    expect(found.next?.id).toBe("d");
  });

  it("stops at the section's edges instead of crossing into the next one", () => {
    const first = findHelpCenterSiblings({ articleId: "a", sections });
    const last = findHelpCenterSiblings({ articleId: "d", sections });
    const only = findHelpCenterSiblings({ articleId: "c", sections });

    expect(first.previous).toBeUndefined();
    expect(first.next?.id).toBe("b");
    expect(last.next).toBeUndefined();
    expect(only.previous).toBeUndefined();
    expect(only.next).toBeUndefined();
  });

  it("finds nothing for an article that is not in the tree", () => {
    const found = findHelpCenterSiblings({ articleId: "missing", sections });

    expect(found.section).toBeUndefined();
    expect(found.previous).toBeUndefined();
    expect(found.next).toBeUndefined();
  });
});

describe("readingMinutes", () => {
  it("never reports less than a minute", () => {
    expect(readingMinutes("Three words here")).toBe(1);
  });

  it("counts roughly two hundred words a minute", () => {
    expect(
      readingMinutes(Array.from({ length: 600 }, () => "word").join(" "))
    ).toBe(3);
  });

  it("does not count a fenced code block as prose", () => {
    const prose = Array.from({ length: 200 }, () => "word").join(" ");

    const code = [
      "```ts",
      ...Array.from({ length: 400 }, () => "code()"),
      "```",
    ].join("\n");

    expect(readingMinutes(`${prose}\n\n${code}`)).toBe(1);
  });
});

describe("formatHelpDate", () => {
  it("renders one date for both a Date and an ISO string", () => {
    const value = new Date("2026-03-04T00:00:00.000Z");

    expect(formatHelpDate(value)).toBe(formatHelpDate(value.toISOString()));
    expect(formatHelpDate(value)).toContain("2026");
  });
});
