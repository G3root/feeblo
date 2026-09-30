import type {
  PublicApiChangelogDetail,
  PublicApiChangelogSource,
} from "./repository";
import type { TPublicApiChangelog, TPublicApiChangelogSummary } from "./schema";

/**
 * A changelog entry for the list projection.
 *
 * No context argument: nothing here is derived from the workspace or the
 * application URL. The public permalink lives on the workspace's own site
 * subdomain, which the Public API does not resolve, so inventing a URL from
 * `APP_URL` would hand a caller a link that does not open the entry.
 */
export const toPublicApiChangelogSummary = (
  entry: PublicApiChangelogSource
): TPublicApiChangelogSummary => ({
  id: entry.id,
  title: entry.title,
  slug: entry.slug,
  excerpt: entry.excerpt,
  coverImage: entry.coverImage,
  status: entry.status,
  scheduledAt: entry.scheduledAt,
  publishedAt: entry.publishedAt,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
});

/** The detail projection: the summary plus the stored, sanitized body. */
export const toPublicApiChangelog = (
  entry: PublicApiChangelogDetail
): TPublicApiChangelog => ({
  ...toPublicApiChangelogSummary(entry),
  content: entry.content,
});
