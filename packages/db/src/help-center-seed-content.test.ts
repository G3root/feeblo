import { describe, expect, it } from "vitest";

import { HELP_CENTER_SEED_TOPICS } from "./help-center-seed-content";

const articles = HELP_CENTER_SEED_TOPICS.flatMap((topic) =>
  topic.articles.map((article) => ({ ...article, topicSlug: topic.slug }))
);

const articleSlugs = new Set(articles.map((article) => article.slug));

/** `/help/articles/<slug>` links, which are the only paths a body may point at. */
const ARTICLE_LINK = /\]\(\/help\/articles\/([a-z0-9-]+)\)/g;

describe("help center seed content", () => {
  it("gives every topic and article a unique slug", () => {
    const topicSlugs = HELP_CENTER_SEED_TOPICS.map((topic) => topic.slug);
    const allArticleSlugs = articles.map((article) => article.slug);

    expect(new Set(topicSlugs).size).toBe(topicSlugs.length);
    expect(new Set(allArticleSlugs).size).toBe(allArticleSlugs.length);
  });

  it("slugifies every slug the way the portal builds a URL", () => {
    for (const slug of [
      ...HELP_CENTER_SEED_TOPICS.map((topic) => topic.slug),
      ...articles.map((article) => article.slug),
    ]) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("points every internal article link at a seeded article", () => {
    const broken = articles.flatMap((article) =>
      [...article.content.matchAll(ARTICLE_LINK)].flatMap((match) => {
        const slug = match[1];

        if (slug === undefined || articleSlugs.has(slug)) {
          return [];
        }

        return [`${article.slug} -> ${slug}`];
      })
    );

    expect(broken).toEqual([]);
  });

  it("writes bodies under the article's title, not beside a second one", () => {
    for (const article of articles) {
      // `##` and below: the title is rendered above the body, so an `#` in the
      // body would be a second page title. A lede paragraph before the first
      // heading is fine — that is how a reader is told what the page covers.
      expect(article.content).not.toMatch(/^# /m);
    }
  });

  it("gives the outline at least one heading to list per article", () => {
    for (const article of articles) {
      expect(article.content).toMatch(/^## /m);
    }
  });

  it("keeps the prose in this product's vocabulary", () => {
    for (const article of articles) {
      // The seed ships in the product, so a competitor's name must not reach a
      // customer's help center.
      expect(article.content.toLowerCase()).not.toContain("featul");
    }
  });

  it("dates every article in the past", () => {
    for (const article of articles) {
      expect(article.publishedDaysAgo).toBeGreaterThan(0);
    }
  });
});
