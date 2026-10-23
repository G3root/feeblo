import type { TBoard } from "@feeblo/domain/board/schema";
import type { TChangelog } from "@feeblo/domain/changelog/schema";
import type { TPostListItem } from "@feeblo/domain/post/schema";
import type { TRoadmap } from "@feeblo/domain/roadmap/schema";
import type { TSite } from "@feeblo/domain/site/schema";
import { describe, expect, it } from "vitest";

import { renderBoardLlmsTxt, type BoardContent } from "./board-llms";

const date = (iso: string) => new Date(iso);

const site = (overrides: Partial<TSite> = {}): TSite => ({
  id: "site_1",
  name: "Acme Feedback",
  logo: null,
  subdomain: "acme",
  customDomain: null,
  changelogVisibility: "PUBLIC",
  roadmapVisibility: "PUBLIC",
  noIndex: false,
  hidePoweredBy: false,
  createdAt: date("2026-01-01T00:00:00.000Z"),
  updatedAt: date("2026-01-01T00:00:00.000Z"),
  organizationId: "org_1",
  ...overrides,
});

const board = (overrides: Partial<TBoard> = {}): TBoard => ({
  id: "brd_1",
  name: "Feature requests",
  slug: "feature-requests",
  visibility: "PUBLIC",
  createdAt: date("2026-01-01T00:00:00.000Z"),
  updatedAt: date("2026-01-01T00:00:00.000Z"),
  organizationId: "org_1",
  ...overrides,
});

const post = (overrides: Partial<TPostListItem> = {}): TPostListItem => ({
  id: "pst_1",
  boardId: "brd_1",
  title: "Dark mode",
  slug: "dark-mode",
  excerpt: "Add a dark theme.",
  statusId: "status_1",
  etaQuarter: null,
  createdAt: date("2026-01-01T00:00:00.000Z"),
  updatedAt: date("2026-01-01T00:00:00.000Z"),
  organizationId: "org_1",
  creatorMemberId: null,
  creatorId: null,
  authorIsMember: false,
  lockedAt: null,
  archivedAt: null,
  mergedIntoPostId: null,
  mergedAt: null,
  user: { name: null, image: null },
  ...overrides,
});

const roadmap = (overrides: Partial<TRoadmap> = {}): TRoadmap => ({
  id: "rmp_1",
  name: "Product roadmap",
  slug: "product",
  description: null,
  isPrimary: true,
  mode: "status",
  visibility: "public",
  filter: { version: 1, operator: "and", conditions: [] },
  organizationId: "org_1",
  createdAt: date("2026-01-01T00:00:00.000Z"),
  updatedAt: date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

const changelog = (overrides: Partial<TChangelog> = {}): TChangelog => ({
  id: "chl_1",
  title: "Dark mode ships",
  slug: "dark-mode-ships",
  content: "",
  excerpt: "Dark mode is available.",
  status: "published",
  coverImage: null,
  scheduledAt: null,
  publishedAt: date("2026-02-01T00:00:00.000Z"),
  organizationId: "org_1",
  creatorMemberId: null,
  creatorId: null,
  createdAt: date("2026-02-01T00:00:00.000Z"),
  updatedAt: date("2026-02-01T00:00:00.000Z"),
  user: { name: null, image: null },
  ...overrides,
});

const content = (overrides: Partial<BoardContent> = {}): BoardContent => ({
  boards: [board()],
  entries: [changelog()],
  posts: [post()],
  roadmaps: [roadmap()],
  ...overrides,
});

describe("renderBoardLlmsTxt", () => {
  it("indexes the public pages and links the sitemap", () => {
    const output = renderBoardLlmsTxt(
      site(),
      "https://acme.example.test",
      content()
    );

    expect(output).toContain("# Acme Feedback");
    expect(output).toContain("https://acme.example.test/sitemap.xml");
    expect(output).toContain(
      "- [Feature requests](https://acme.example.test/b/feature-requests)"
    );
    expect(output).toContain(
      "- [Dark mode](https://acme.example.test/p/dark-mode): Add a dark theme."
    );
    expect(output).toContain(
      "- [Product roadmap](https://acme.example.test/roadmap/product)"
    );
    expect(output).toContain(
      "- [Dark mode ships](https://acme.example.test/changelog/dark-mode-ships)"
    );
  });

  it("orders posts by most recently updated", () => {
    const output = renderBoardLlmsTxt(
      site(),
      "https://acme.example.test",
      content({
        posts: [
          post({
            title: "Old",
            slug: "old",
            updatedAt: date("2026-01-01T00:00:00.000Z"),
          }),
          post({
            title: "New",
            slug: "new",
            updatedAt: date("2026-03-01T00:00:00.000Z"),
          }),
        ],
      })
    );

    expect(output.indexOf("[New]")).toBeLessThan(output.indexOf("[Old]"));
  });

  it("omits a hidden roadmap and changelog even when content is supplied", () => {
    const output = renderBoardLlmsTxt(
      site({ roadmapVisibility: "HIDDEN", changelogVisibility: "HIDDEN" }),
      "https://acme.example.test",
      content()
    );

    expect(output).not.toContain("## Roadmap");
    expect(output).not.toContain("## Changelog");
    expect(output).not.toContain("changelog/rss.xml");
  });

  it("omits the platform link when the site hides Feeblo branding", () => {
    const output = renderBoardLlmsTxt(
      site({ hidePoweredBy: true }),
      "https://acme.example.test",
      content()
    );

    expect(output).not.toContain("https://feeblo.com");
  });

  it("escapes Markdown metacharacters in titles", () => {
    const output = renderBoardLlmsTxt(
      site(),
      "https://acme.example.test",
      content({
        posts: [post({ title: "Support [beta] plans", slug: "beta" })],
      })
    );

    expect(output).toContain(
      "- [Support \\[beta\\] plans](https://acme.example.test/p/beta)"
    );
  });

  it("collapses a multiline title into one link line", () => {
    const output = renderBoardLlmsTxt(
      site(),
      "https://acme.example.test",
      content({
        posts: [post({ title: "First\n\nSecond", slug: "multiline" })],
      })
    );

    expect(output).toContain(
      "- [First Second](https://acme.example.test/p/multiline)"
    );
    expect(output).not.toContain("First\n\nSecond");
  });

  it("caps the recent posts and collapses a long excerpt", () => {
    const posts = Array.from({ length: 60 }, (_, index) =>
      post({
        title: `Post ${index}`,
        slug: `post-${index}`,
        updatedAt: date(
          `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`
        ),
        excerpt: "x".repeat(400),
      })
    );
    const output = renderBoardLlmsTxt(
      site(),
      "https://acme.example.test",
      content({ posts })
    );

    expect(output).toContain("The 50 most recently updated posts.");
    expect(output).toContain("…");
    expect(output).not.toContain("Post 59]");
  });
});
