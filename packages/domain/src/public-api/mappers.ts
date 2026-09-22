import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";

import type { PublicApiDetailedPost, PublicApiListedPost } from "./repository";
import type { TPublicApiPost, TPublicApiPostSummary } from "./schema";

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
  tags: post.tags.map((tag) => ({ id: tag.id, name: tag.name })),
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
