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
  // Named field by field rather than spread: the repository row carries ids
  // and timestamps the payload does not, and this is the boundary where they
  // stop.
  categories: entry.categories.map((category) => ({
    icon: category.icon,
    iconType: category.iconType,
    id: category.id,
    name: category.name,
  })),
  linkedPosts: entry.linkedPosts.map((post) => ({
    id: post.id,
    slug: post.slug,
    title: post.title,
  })),
});

/** The detail projection: the summary plus the stored, sanitized body. */
export const toPublicApiChangelog = (
  entry: PublicApiChangelogDetail
): TPublicApiChangelog => ({
  ...toPublicApiChangelogSummary(entry),
  content: entry.content,
});
