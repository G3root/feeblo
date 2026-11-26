import type {
  THelpCenterArticlePublic,
  THelpCenterArticlePublicSummary,
} from "@feeblo/domain/help-center-article/schema";
import type { TSite } from "@feeblo/domain/site/schema";

/**
 * The article's Markdown mirror, which is what an assistant is pointed at.
 *
 * The mirror lives under a literal `raw` segment rather than as a `.md`
 * suffix on the article URL. A slug is only a string, so an article may
 * legitimately be named `api.md`; reserving the suffix would make that
 * article's HTML page and the mirror of `api` the same URL. The extra segment
 * keeps the two URL spaces disjoint.
 */
export const helpCenterArticleMarkdownUrl = (origin: string, slug: string) =>
  `${origin}/help/articles/raw/${encodeURIComponent(slug)}.md`;

/**
 * The MCP server's stable name for one workspace.
 *
 * Derived from the subdomain rather than the display name: the value becomes
 * part of a client's config key and a shell command, and a workspace can
 * rename itself without renaming every reader's connection.
 */
export const helpCenterMcpServerId = (site: TSite): string => {
  const id = site.subdomain
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

  return `${id || "workspace"}-help`;
};

/**
 * `YYYY-MM-DD`, independent of the reader's locale.
 *
 * The page formats a date for a person; these surfaces are read by machines,
 * and a server-rendered Markdown body must not change with the server's
 * locale.
 */
const agentDate = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);

const archivedSuffix = (article: { readonly isArchived: boolean }) =>
  article.isArchived ? " · Archived" : "";

/**
 * One article as the Markdown an assistant should read.
 *
 * The title and section are metadata on the row rather than the body, so they
 * are added here; a body that already opens with an H1 carrying the same
 * title is left alone rather than given a second one. A different opening
 * heading is the article's own section heading, so the title is still added —
 * otherwise a document titled "Account setup" that opens with "# Before you
 * begin" would lose its identity in every download and MCP reply.
 */
export function renderHelpCenterArticleMarkdown(
  article: THelpCenterArticlePublic,
  origin: string
): string {
  const content = article.content.trim();
  const openingHeading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
  const hasOwnTitle = openingHeading === article.title.trim();
  const title = hasOwnTitle ? "" : `# ${article.title}\n\n`;

  const meta = [
    `> ${article.topicName}${archivedSuffix(article)} · Updated ${agentDate(article.updatedAt)}`,
    `> ${helpCenterArticleMarkdownUrl(origin, article.slug)}`,
  ].join("\n");

  return `${title}${meta}\n\n${content}\n`;
}

/**
 * The help center as one index, grouped the way the portal groups it.
 *
 * Deliberately a list of titles and Markdown URLs rather than an index of
 * excerpts: an agent that needs the body calls the detail tool, and a summary
 * here would be a second, shorter copy of a document it is about to read.
 */
export function renderHelpCenterArticleIndex(
  site: TSite,
  articles: ReadonlyArray<THelpCenterArticlePublicSummary>,
  origin: string
): string {
  const lines = [`# ${site.name} help center`, ""];

  if (articles.length === 0) {
    lines.push("No articles are published yet.", "");
  } else {
    lines.push(
      `${articles.length} published ${articles.length === 1 ? "article" : "articles"}, readable without a session.`,
      ""
    );

    let currentTopic: string | undefined;

    for (const article of articles) {
      if (article.topicName !== currentTopic) {
        currentTopic = article.topicName;
        lines.push(`## ${currentTopic}`, "");
      }

      lines.push(
        `- ${article.title}${archivedSuffix(article)} (${helpCenterArticleMarkdownUrl(origin, article.slug)})`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}
