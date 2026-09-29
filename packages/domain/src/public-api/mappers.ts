import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";

import type {
  PublicApiChangelogDetail,
  PublicApiChangelogSource,
  PublicApiCommentSource,
  PublicApiCompanySource,
  PublicApiDetailedPost,
  PublicApiListedPost,
  PublicApiPostTag,
  PublicApiTagSource,
} from "./repository";
import type {
  TPublicApiChangelog,
  TPublicApiChangelogSummary,
  TPublicApiComment,
  TPublicApiCompany,
  TPublicApiPost,
  TPublicApiPostSummary,
  TPublicApiTag,
  TPublicApiTagDetail,
} from "./schema";

export type PublicApiMapperContext = {
  /** Application base URL, without a trailing slash. */
  readonly appUrl: string;
  readonly organizationId: string;
};

/**
 * The public board URL for a post. Mirrors the link the dashboard, emails, and
 * webhooks produce, so a caller can hand the same URL back to a human.
 */
const postUrl = (post: PublicApiListedPost, context: PublicApiMapperContext) =>
  [
    context.appUrl,
    encodeURIComponent(context.organizationId),
    "post",
    encodeURIComponent(post.boardSlug),
    encodeURIComponent(post.slug),
  ].join("/");

/**
 * A non-empty status name.
 *
 * `post_status.label` is user-facing and may be empty until a workspace
 * customizes it, and an API response with an empty status name is useless.
 * The dashboard and portal fall back to the same humanized type through
 * `@feeblo/web-shared/board/constants`, which this package cannot import
 * without inverting the dependency direction, so the rule is restated here.
 */
const statusName = (status: {
  readonly name: string;
  readonly type: TPostStatusType;
}): string => {
  const label = status.name.trim();
  if (label.length > 0) {
    return label;
  }

  const [first = "", ...rest] = status.type.toLowerCase().split("_");
  const capitalized = first.charAt(0).toUpperCase() + first.slice(1);
  return [capitalized, ...rest].join(" ");
};

/**
 * Row → DTO mappers for the public contract.
 *
 * Every field is named explicitly. The mappers accept the repository's narrow
 * source types rather than dashboard rows, so a column added to a dashboard
 * read model cannot flow into a public response, and an internal actor
 * identifier has no name here to be passed through. See ADR 0004.
 */
export const toPublicApiPostSummary = (
  post: PublicApiListedPost,
  context: PublicApiMapperContext
): TPublicApiPostSummary => ({
  id: post.id,
  boardId: post.boardId,
  title: post.title,
  slug: post.slug,
  excerpt: post.excerpt,
  url: postUrl(post, context),
  status: {
    id: post.status.id,
    name: statusName(post.status),
    type: post.status.type,
  },
  etaQuarter: post.etaQuarter,
  tags: post.tags.map(toPublicApiTag),
  voteCount: post.voteCount,
  commentCount: post.commentCount,
  author: {
    type: post.author.type,
    displayName: post.author.displayName,
    avatarUrl: post.author.avatarUrl,
  },
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  lockedAt: post.lockedAt,
  archivedAt: post.archivedAt,
  mergedIntoPostId: post.mergedIntoPostId,
});

/** The detail projection: the summary plus the stored, sanitized body. */
export const toPublicApiPost = (
  post: PublicApiDetailedPost,
  context: PublicApiMapperContext
): TPublicApiPost => ({
  ...toPublicApiPostSummary(post, context),
  content: post.content,
});

/**
 * A tag reference, as a post payload embeds it.
 *
 * One mapper for both places a reference appears — the `tags` array of a post
 * and the response of setting a post's tags — so the two cannot drift apart.
 */
export const toPublicApiTag = (tag: PublicApiPostTag): TPublicApiTag => ({
  id: tag.id,
  name: tag.name,
});

/**
 * A tag as the tag endpoints return it.
 *
 * No context argument: nothing in a tag is derived from the workspace or the
 * application URL, and taking a context that is never read would invite the
 * next field to be composed from it without thinking about what a machine key
 * is allowed to see.
 */
export const toPublicApiTagDetail = (
  tag: PublicApiTagSource
): TPublicApiTagDetail => ({
  id: tag.id,
  name: tag.name,
  slug: tag.slug,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

/**
 * A comment as the comment endpoints return it.
 *
 * No context argument, like the tag and company mappers: nothing in a comment
 * is derived from the application URL or the workspace, and taking a context
 * that is never read would invite the next field to be composed from it
 * without thinking about what a machine key is allowed to see. The author is
 * rebuilt field by field from the source's nested shape so a column added to
 * the row cannot flow through.
 */
export const toPublicApiComment = (
  comment: PublicApiCommentSource
): TPublicApiComment => ({
  id: comment.id,
  postId: comment.postId,
  content: comment.content,
  visibility: comment.visibility,
  parentCommentId: comment.parentCommentId,
  pinnedAt: comment.pinnedAt,
  author: {
    type: comment.author.type,
    displayName: comment.author.displayName,
    avatarUrl: comment.author.avatarUrl,
  },
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
});

/**
 * A company as the company endpoints return it.
 *
 * Like the tag detail mapper and unlike the post mappers, this takes no
 * context: nothing in a company is derived from the application URL or the
 * workspace, and taking a context that is never read would invite the next
 * field to be composed from it without thinking about what a machine key is
 * allowed to see. The contacts who belong to the company have no name here to
 * be passed through.
 */
export const toPublicApiCompany = (
  company: PublicApiCompanySource
): TPublicApiCompany => ({
  id: company.id,
  name: company.name,
  externalId: company.externalId,
  avatar: company.avatar,
  externalCreatedAt: company.externalCreatedAt,
  source: company.source,
  createdAt: company.createdAt,
  updatedAt: company.updatedAt,
});

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
