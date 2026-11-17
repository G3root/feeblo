import type { TBoard } from "@feeblo/domain/board/schema";
import type { TChangelog } from "@feeblo/domain/changelog/schema";
import type { TPostListItem } from "@feeblo/domain/post/schema";
import type { TRoadmap } from "@feeblo/domain/roadmap/schema";
import type { TSite } from "@feeblo/domain/site/schema";

/**
 * The public lists the board's `llms.txt` renders.
 *
 * The endpoint fetches these once and hands them over, so the renderer stays
 * pure: a test can describe a board without a database, and the same content
 * powers the sitemap.
 */
export interface BoardContent {
  readonly boards: ReadonlyArray<TBoard>;
  readonly entries: ReadonlyArray<TChangelog>;
  readonly posts: ReadonlyArray<TPostListItem>;
  readonly roadmaps: ReadonlyArray<TRoadmap>;
}

/**
 * How many posts the board's llms.txt lists.
 *
 * The sitemap already carries every public URL, so the index does not need to
 * repeat an unbounded list: an agent reads the recent posts to learn the
 * vocabulary and then follows a post or the sitemap for the rest. The cap also
 * bounds the response size for a board with thousands of posts.
 */
const BOARD_LLMS_POST_LIMIT = 50;

const BOARD_LLMS_EXCERPT_LIMIT = 180;

/** Any run of whitespace, collapsed so a line stays one line. */
const whitespaceRunPattern = /\s+/gu;

/** The characters that end a Markdown link label or list item. */
const markdownEscapePattern = /([\\[\]])/gu;

const clampLine = (value: string, limit: number) => {
  const collapsed = value.replaceAll(whitespaceRunPattern, " ").trim();

  return collapsed.length <= limit
    ? collapsed
    : `${collapsed.slice(0, limit).trimEnd()}…`;
};

/** Escape a value that sits inside a Markdown link label or list item. */
const escapeMarkdownText = (value: string) =>
  value
    .replaceAll(whitespaceRunPattern, " ")
    .trim()
    .replaceAll(markdownEscapePattern, "\\$1");

const markdownLine = (label: string, url: string, detail?: string) => {
  const text = escapeMarkdownText(label);
  const suffix = detail === undefined ? "" : `: ${detail}`;

  return `- [${text}](${url})${suffix}`;
};

/**
 * The board's `llms.txt`: a Markdown index of the public pages an agent may
 * read without a session.
 *
 * It is generated from the same public lists as the sitemap, so a post that is
 * hidden from a crawler is hidden from this file too. The file is deliberately
 * plain text rather than HTML: the llms.txt convention is a text index, and an
 * agent that fetched it already knows how to parse Markdown.
 */
const renderBoardsSection = (
  boards: BoardContent["boards"],
  origin: string
): string[] =>
  boards.length === 0
    ? []
    : [
        "",
        "## Boards",
        "",
        ...boards.map((board) =>
          markdownLine(board.name, `${origin}/b/${board.slug}`)
        ),
      ];

const renderPostsSection = (
  posts: BoardContent["posts"],
  origin: string
): string[] => {
  if (posts.length === 0) return [];

  const recent = posts
    .toSorted(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
    )
    .slice(0, BOARD_LLMS_POST_LIMIT);

  const summary =
    recent.length === 1
      ? "The most recently updated post."
      : `The ${recent.length} most recently updated posts.`;

  return [
    "",
    "## Feedback posts",
    "",
    `${summary} The sitemap lists every post URL.`,
    "",
    ...recent.map((post) =>
      markdownLine(
        post.title,
        `${origin}/p/${post.slug}`,
        clampLine(post.excerpt, BOARD_LLMS_EXCERPT_LIMIT)
      )
    ),
  ];
};

const renderRoadmapSection = (
  site: TSite,
  roadmaps: BoardContent["roadmaps"],
  origin: string
): string[] =>
  site.roadmapVisibility !== "PUBLIC" || roadmaps.length === 0
    ? []
    : [
        "",
        "## Roadmap",
        "",
        ...roadmaps.map((roadmap) =>
          markdownLine(roadmap.name, `${origin}/roadmap/${roadmap.slug}`)
        ),
      ];

const renderChangelogSection = (
  site: TSite,
  entries: BoardContent["entries"],
  origin: string
): string[] => {
  if (site.changelogVisibility !== "PUBLIC" || entries.length === 0) return [];

  const recent = entries.toSorted(
    (left, right) =>
      (right.publishedAt ?? right.createdAt).getTime() -
      (left.publishedAt ?? left.createdAt).getTime()
  );

  return [
    "",
    "## Changelog",
    "",
    ...recent.map((entry) =>
      markdownLine(entry.title, `${origin}/changelog/${entry.slug}`)
    ),
  ];
};

export function renderBoardLlmsTxt(
  site: TSite,
  origin: string,
  content: BoardContent
): string {
  const name = escapeMarkdownText(site.name);

  const lines = [
    `# ${name}`,
    "",
    `> ${name} collects feedback, publishes a roadmap, and announces releases.`,
    "",
    `- Home: ${origin}/`,
    `- Every public page: ${origin}/sitemap.xml`,
    ...(site.changelogVisibility === "PUBLIC"
      ? [`- Changelog feed: ${origin}/changelog/rss.xml`]
      : []),
    ...(site.hidePoweredBy ? [] : ["- Platform: https://feeblo.com"]),
    ...renderBoardsSection(content.boards, origin),
    ...renderPostsSection(content.posts, origin),
    ...renderRoadmapSection(site, content.roadmaps, origin),
    ...renderChangelogSection(site, content.entries, origin),
    "",
    "## About this file",
    "",
    "This is the llms.txt index for a public feedback board. It lists pages a visitor can read without a session. The sitemap carries every public URL, and this file follows the site's visibility settings: a hidden board, roadmap, or changelog is absent here as well.",
  ];

  return `${lines.join("\n")}\n`;
}
