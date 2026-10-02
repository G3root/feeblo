import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";

import { statusDisplayName } from "../../post-status/public-api/mappers";
import { toPublicApiTag } from "../../tag/public-api/mappers";
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
 * The rule lives with the status resource (`statusDisplayName`), which the
 * statuses endpoint uses too, so a post's embedded status and the catalog
 * cannot call the same status two different things.
 */
const statusName = (status: {
  readonly name: string;
  readonly type: TPostStatusType;
}): string => statusDisplayName(status.name, status.type);

/**
 * Row → DTO mappers for the public post contract.
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
