import type {
  THelpCenterArticlePublic,
  THelpCenterArticlePublicSummary,
} from "@feeblo/domain/help-center-article/schema";
import type { TSite } from "@feeblo/domain/site/schema";
import { describe, expect, it } from "vitest";

import {
  helpCenterArticleMarkdownUrl,
  helpCenterMcpServerId,
  renderHelpCenterArticleIndex,
  renderHelpCenterArticleMarkdown,
} from "./help-center-agent";

const ORIGIN = "https://acme.example.test";

const site = (overrides: Partial<TSite> = {}): TSite => ({
  changelogVisibility: "PUBLIC",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  customDomain: null,
  helpCenterVisibility: "PUBLIC",
  hidePoweredBy: false,
  id: "site_1",
  logo: null,
  name: "Acme",
  noIndex: false,
  organizationId: "org_1",
  roadmapVisibility: "PUBLIC",
  subdomain: "acme",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

const article = (
  overrides: Partial<THelpCenterArticlePublic> = {}
): THelpCenterArticlePublic => ({
  authorName: "Ada",
  content: "Feeblo is a customer feedback platform.\n\n## The board\n\n...",
  coverImage: null,
  excerpt: "Feeblo is a customer feedback platform.",
  helpfulCount: 0,
  id: "article_1",
  isArchived: false,
  notHelpfulCount: 0,
  publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  slug: "what-is-feeblo",
  title: "What is Feeblo?",
  topicId: "topic_1",
  topicName: "Getting started",
  topicSlug: "getting-started",
  updatedAt: new Date("2026-07-28T00:00:00.000Z"),
  viewCount: 0,
  ...overrides,
});

const summary = (
  overrides: Partial<THelpCenterArticlePublicSummary> = {}
): THelpCenterArticlePublicSummary => ({
  excerpt: "Feeblo is a customer feedback platform.",
  helpfulCount: 0,
  id: "article_1",
  isArchived: false,
  notHelpfulCount: 0,
  publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  slug: "what-is-feeblo",
  title: "What is Feeblo?",
  topicId: "topic_1",
  topicName: "Getting started",
  topicSlug: "getting-started",
  updatedAt: new Date("2026-07-28T00:00:00.000Z"),
  viewCount: 0,
  ...overrides,
});

describe("helpCenterArticleMarkdownUrl", () => {
  it("puts the mirror under a raw segment so it cannot shadow an article slug", () => {
    expect(helpCenterArticleMarkdownUrl(ORIGIN, "what-is-feeblo")).toBe(
      `${ORIGIN}/help/articles/raw/what-is-feeblo.md`
    );
  });
});

describe("helpCenterMcpServerId", () => {
  it("derives a stable, command-safe name from the subdomain", () => {
    expect(helpCenterMcpServerId(site())).toBe("acme-help");
    expect(helpCenterMcpServerId(site({ subdomain: "Acme Team" }))).toBe(
      "acme-team-help"
    );
    expect(helpCenterMcpServerId(site({ subdomain: "---" }))).toBe(
      "workspace-help"
    );
  });
});

describe("renderHelpCenterArticleMarkdown", () => {
  it("adds the title, section, date and mirror URL around the stored body", () => {
    const output = renderHelpCenterArticleMarkdown(article(), ORIGIN);

    expect(output).toContain("# What is Feeblo?");
    expect(output).toContain(
      "> Getting started · Updated 2026-07-28\n> https://acme.example.test/help/articles/raw/what-is-feeblo.md"
    );
    expect(output).toContain("## The board");
  });

  it("marks a withdrawn article instead of hiding it", () => {
    expect(
      renderHelpCenterArticleMarkdown(article({ isArchived: true }), ORIGIN)
    ).toContain("Getting started · Archived");
  });

  it("does not repeat a level-one heading that matches the title", () => {
    const output = renderHelpCenterArticleMarkdown(
      article({ content: "# What is Feeblo?\n\nThe body." }),
      ORIGIN
    );

    expect(output.match(/# What is Feeblo\?/gu)).toHaveLength(1);
  });

  it("keeps the title when the body opens with a different heading", () => {
    const output = renderHelpCenterArticleMarkdown(
      article({
        content: "# Before you begin\n\nThe body.",
        title: "Account setup",
      }),
      ORIGIN
    );

    expect(output).toContain("# Account setup");
    expect(output).toContain("# Before you begin");
  });
});

describe("renderHelpCenterArticleIndex", () => {
  it("groups articles by section in the order the list arrived", () => {
    const output = renderHelpCenterArticleIndex(
      site(),
      [
        summary(),
        summary({
          id: "article_2",
          slug: "members-and-roles",
          title: "Members and roles",
        }),
        summary({
          id: "article_3",
          slug: "integrations",
          title: "Integrations",
          topicName: "Integrations",
          topicSlug: "integrations",
        }),
      ],
      ORIGIN
    );

    expect(output).toContain("# Acme help center");
    expect(output).toContain(
      "3 published articles, readable without a session."
    );
    expect(output).toContain("## Getting started");
    expect(output).toContain("## Integrations");
    expect(output.indexOf("## Getting started")).toBeLessThan(
      output.indexOf("## Integrations")
    );
    expect(output).toContain(
      "- Members and roles (https://acme.example.test/help/articles/raw/members-and-roles.md)"
    );
  });

  it("says so when nothing is published", () => {
    expect(renderHelpCenterArticleIndex(site(), [], ORIGIN)).toContain(
      "No articles are published yet."
    );
  });
});
